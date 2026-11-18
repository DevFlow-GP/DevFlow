"""Thin async client for the Jenkins REST API.

Raises JenkinsError only; mapping it to HTTP responses is the service layer's
job. The API token is never logged.

Jenkins exposes every page's data as JSON at `<page>/api/json`, so each method
here is one of those pages (or a POST that starts something).
"""

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote, urlparse
from xml.sax.saxutils import escape

import httpx

_TIMEOUT = httpx.Timeout(10.0)
_BUILD_FIELDS = "number,result,building,timestamp,duration,url"
# Jenkins' global credentials store (Credentials plugin), default domain.
_CREDENTIALS_STORE = "/credentials/store/system/domain/_"


class JenkinsError(Exception):
    """Jenkins was unreachable, rejected our credentials, or answered unexpectedly."""


@dataclass(frozen=True)
class JenkinsBuild:
    number: int
    # SUCCESS, FAILURE, UNSTABLE, ABORTED or NOT_BUILT; None while it's running.
    result: str | None
    building: bool
    started_at: datetime
    duration_ms: int
    url: str

    @classmethod
    def from_api(cls, data: dict[str, Any]) -> "JenkinsBuild":
        return cls(
            number=data["number"],
            result=data.get("result"),
            building=data.get("building", False),
            started_at=datetime.fromtimestamp(data["timestamp"] / 1000, tz=timezone.utc),
            duration_ms=data.get("duration", 0),
            url=data["url"],
        )


@dataclass(frozen=True)
class JenkinsQueueItem:
    id: int
    # Path of the job this item will run, e.g. "/job/my-app/".
    job_path: str
    cancelled: bool
    # Set once an executor picks the item up; None while it waits.
    build_number: int | None
    # Jenkins' reason for waiting, e.g. "Waiting for next available executor".
    why: str | None


def job_path(job: str) -> str:
    """URL path of a job; "team/my-app" (a job in a folder) is /job/team/job/my-app/."""
    return "".join(f"/job/{quote(part, safe='')}" for part in job.split("/")) + "/"


class JenkinsClient:
    def __init__(self, *, url: str, user: str, token: str) -> None:
        self._url = url.rstrip("/")
        self._auth = (user, token)

    async def trigger_build(
        self, job: str, params: dict[str, str] | None = None
    ) -> int | None:
        """Queue a build and return its queue item id; None if the job doesn't exist.

        A parameterized job must get `params` (an empty dict uses the job's
        defaults): Jenkins answers 400 to a plain build of such a job, and also
        rejects parameters sent to a job that has none.

        The build number isn't known yet: Jenkins assigns it when an executor
        picks the item up. Poll get_queue_item() for it.
        """
        # API-token auth doesn't need a CSRF crumb.
        if params is None:
            response = await self._request("POST", f"{job_path(job)}build")
        else:
            response = await self._request(
                "POST", f"{job_path(job)}buildWithParameters", data=params
            )
        if response.status_code == 404:
            return None
        if response.status_code != 201:
            raise JenkinsError(f"Triggering a build returned HTTP {response.status_code}")
        # Location: <jenkins>/queue/item/<id>/
        location = response.headers.get("Location", "")
        try:
            return int(location.rstrip("/").rsplit("/", 1)[1])
        except (IndexError, ValueError) as exc:
            raise JenkinsError("Jenkins did not return a queue item") from exc

    async def get_queue_item(self, queue_id: int) -> JenkinsQueueItem | None:
        """None once Jenkins forgets the item (a few minutes after it starts)."""
        response = await self._request("GET", f"/queue/item/{queue_id}/api/json")
        if response.status_code == 404:
            return None
        self._expect_ok(response)
        data = response.json()
        executable = data.get("executable") or {}
        return JenkinsQueueItem(
            id=data["id"],
            job_path=urlparse(data.get("task", {}).get("url", "")).path,
            cancelled=data.get("cancelled", False),
            build_number=executable.get("number"),
            why=data.get("why"),
        )

    async def list_builds(self, job: str, *, limit: int) -> list[JenkinsBuild] | None:
        """Most recent first; None if the job doesn't exist."""
        response = await self._request(
            "GET",
            f"{job_path(job)}api/json",
            params={"tree": f"builds[{_BUILD_FIELDS}]{{0,{limit}}}"},
        )
        if response.status_code == 404:
            return None
        self._expect_ok(response)
        return [JenkinsBuild.from_api(item) for item in response.json().get("builds", [])]

    async def get_build(self, job: str, number: int) -> JenkinsBuild | None:
        response = await self._request(
            "GET",
            f"{job_path(job)}{number}/api/json",
            params={"tree": _BUILD_FIELDS},
        )
        if response.status_code == 404:
            return None
        self._expect_ok(response)
        return JenkinsBuild.from_api(response.json())

    async def get_console_text(self, job: str, number: int) -> str | None:
        response = await self._request("GET", f"{job_path(job)}{number}/consoleText")
        if response.status_code == 404:
            return None
        self._expect_ok(response)
        return response.text

    async def job_exists(self, job: str) -> bool:
        response = await self._request("GET", f"{job_path(job)}api/json", params={"tree": "name"})
        if response.status_code == 404:
            return False
        self._expect_ok(response)
        return True

    async def create_job(self, job: str, config_xml: str) -> bool:
        """Create `job` from `config_xml`; False if its parent folder doesn't exist.

        Also True when the job already exists, so two first builds racing to
        create it both succeed.
        """
        parent, _, name = job.rpartition("/")
        response = await self._request(
            "POST",
            f"{job_path(parent) if parent else '/'}createItem",
            params={"name": name},
            content=config_xml,
            headers={"Content-Type": "application/xml"},
        )
        if response.status_code == 404:
            return False
        if response.status_code == 400 and "already exists" in response.headers.get("X-Error", ""):
            return True
        self._expect_ok(response)
        return True

    async def delete_job(self, job: str) -> None:
        """Delete `job` and its builds. A job that's already gone counts as deleted."""
        response = await self._request("POST", f"{job_path(job)}doDelete")
        # doDelete usually answers with a redirect to the parent, which we don't follow.
        if response.status_code != 404 and not 200 <= response.status_code < 400:
            raise JenkinsError(f"Deleting a job returned HTTP {response.status_code}")

    async def put_credentials(
        self,
        credential_id: str,
        *,
        username: str,
        password: str,
        description: str,
    ) -> None:
        """Create or replace a username/password credential in the global store.

        Pipelines refer to it by `credential_id`; Jenkins keeps the password
        encrypted and masks it in build logs. Needs Credentials Create and
        Update permission for DevFlow's Jenkins user.
        """
        body = (
            "<com.cloudbees.plugins.credentials.impl.UsernamePasswordCredentialsImpl>"
            "<scope>GLOBAL</scope>"
            f"<id>{escape(credential_id)}</id>"
            f"<description>{escape(description)}</description>"
            f"<username>{escape(username)}</username>"
            f"<password>{escape(password)}</password>"
            "</com.cloudbees.plugins.credentials.impl.UsernamePasswordCredentialsImpl>"
        )
        headers = {"Content-Type": "application/xml"}
        # Update in place; 404 means it doesn't exist yet.
        response = await self._request(
            "POST",
            f"{_CREDENTIALS_STORE}/credential/{quote(credential_id, safe='')}/config.xml",
            content=body,
            headers=headers,
        )
        if response.status_code == 404:
            response = await self._request(
                "POST", f"{_CREDENTIALS_STORE}/createCredentials", content=body, headers=headers
            )
        # Jenkins answers some form-style POSTs with a redirect on success.
        if not 200 <= response.status_code < 400:
            raise JenkinsError(f"Saving credentials returned HTTP {response.status_code}")

    async def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        try:
            async with httpx.AsyncClient(
                base_url=self._url, auth=self._auth, timeout=_TIMEOUT
            ) as client:
                response = await client.request(method, path, **kwargs)
        except httpx.HTTPError as exc:
            raise JenkinsError("Could not reach Jenkins") from exc
        # Our server-wide credentials are wrong; no user can fix that, so it's not a 404.
        if response.status_code in (401, 403):
            raise JenkinsError(f"Jenkins rejected DevFlow's credentials (HTTP {response.status_code})")
        return response

    @staticmethod
    def _expect_ok(response: httpx.Response) -> None:
        if response.status_code != 200:
            raise JenkinsError(f"Jenkins API returned HTTP {response.status_code}")
