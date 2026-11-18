"""The real JenkinsClient against a mock HTTP transport: URLs, status handling."""

from collections.abc import Callable
from functools import partial

import httpx
import pytest

from app.integrations import jenkins as jenkins_module
from app.integrations.jenkins import JenkinsClient, JenkinsError

JOB = "user-apps/python/3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90"
JOB_URL = "/job/user-apps/job/python/job/3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90/"


@pytest.fixture
def respond(monkeypatch: pytest.MonkeyPatch) -> Callable[..., list[httpx.Request]]:
    """respond(handler) routes the client's requests to `handler`; returns the requests seen."""

    def install(handler: Callable[[httpx.Request], httpx.Response]) -> list[httpx.Request]:
        seen: list[httpx.Request] = []

        def record(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            return handler(request)

        monkeypatch.setattr(
            jenkins_module.httpx,
            "AsyncClient",
            partial(httpx.AsyncClient, transport=httpx.MockTransport(record)),
        )
        return seen

    return install


def _client() -> JenkinsClient:
    return JenkinsClient(url="http://jenkins.test", user="devflow", token="t")


@pytest.mark.asyncio
@pytest.mark.parametrize(("status", "exists"), [(200, True), (404, False)])
async def test_job_exists(respond, status: int, exists: bool) -> None:
    seen = respond(lambda request: httpx.Response(status, json={"name": "x"}))
    assert await _client().job_exists(JOB) is exists
    assert seen[0].method == "GET"
    assert seen[0].url.path == f"{JOB_URL}api/json"
    assert seen[0].url.params["tree"] == "name"


@pytest.mark.asyncio
async def test_create_job_posts_config_to_parent_folder(respond) -> None:
    seen = respond(lambda request: httpx.Response(200))
    assert await _client().create_job(JOB, "<flow-definition/>") is True
    request = seen[0]
    assert request.method == "POST"
    assert request.url.path == "/job/user-apps/job/python/createItem"
    assert request.url.params["name"] == "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90"
    assert request.headers["Content-Type"] == "application/xml"
    assert request.content == b"<flow-definition/>"


@pytest.mark.asyncio
async def test_create_job_in_missing_folder_returns_false(respond) -> None:
    respond(lambda request: httpx.Response(404))
    assert await _client().create_job(JOB, "<x/>") is False


@pytest.mark.asyncio
async def test_create_job_that_already_exists_is_success(respond) -> None:
    respond(lambda request: httpx.Response(400, headers={"X-Error": "A job already exists with the name '3f2a'"}))
    assert await _client().create_job(JOB, "<x/>") is True


@pytest.mark.asyncio
async def test_create_job_other_400_raises(respond) -> None:
    respond(lambda request: httpx.Response(400, headers={"X-Error": "No name is specified"}))
    with pytest.raises(JenkinsError):
        await _client().create_job(JOB, "<x/>")


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [200, 302, 404])
async def test_delete_job_accepts_ok_redirect_and_gone(respond, status: int) -> None:
    seen = respond(lambda request: httpx.Response(status))
    await _client().delete_job(JOB)
    assert seen[0].method == "POST"
    assert seen[0].url.path == f"{JOB_URL}doDelete"


@pytest.mark.asyncio
async def test_delete_job_server_error_raises(respond) -> None:
    respond(lambda request: httpx.Response(500))
    with pytest.raises(JenkinsError):
        await _client().delete_job(JOB)


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [401, 403])
async def test_bad_credentials_raise(respond, status: int) -> None:
    respond(lambda request: httpx.Response(status))
    with pytest.raises(JenkinsError):
        await _client().job_exists(JOB)
