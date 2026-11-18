import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.jenkins import job_path
from app.models.team import user_teams
from app.models.user import User
from tests.conftest import auth_header, connect_github, register_user, user_id
from tests.fakes import FakeGitHubClient, FakeJenkinsClient, make_build, make_repo


@pytest.fixture
def jenkins(fake_github: FakeGitHubClient, fake_jenkins: FakeJenkinsClient) -> FakeJenkinsClient:
    fake_github.repos = [make_repo(101, "octocat/hello-world")]
    fake_jenkins.jobs["my-app"] = []
    return fake_jenkins


async def _project(
    client: AsyncClient,
    fake_github: FakeGitHubClient,
    *,
    email: str = "dev@example.com",
    jenkins_job: str | None = "my-app",
    **register_overrides: str,
) -> tuple[str, dict]:
    """A user with a project linked to `jenkins_job`; returns (token, project)."""
    token = await register_user(client, email, **register_overrides)
    await connect_github(client, fake_github, token, github_token=f"gho_{email}", code=email)
    created = await client.post(
        "/projects",
        json={"repo_full_name": "octocat/hello-world"},
        headers=auth_header(token),
    )
    assert created.status_code == 201, created.text
    project = created.json()
    if jenkins_job is not None:
        patched = await client.patch(
            f"/projects/{project['id']}",
            json={"jenkins_job": jenkins_job},
            headers=auth_header(token),
        )
        assert patched.status_code == 200, patched.text
        project = patched.json()
    return token, project


def test_job_path_nests_folders_and_escapes_names() -> None:
    assert job_path("my-app") == "/job/my-app/"
    assert job_path("team/my app") == "/job/team/job/my%20app/"


# --- linking a job --------------------------------------------------------------


@pytest.mark.asyncio
async def test_project_starts_without_jenkins_job(
    client: AsyncClient,
    jenkins: FakeJenkinsClient,
    fake_github: FakeGitHubClient,
) -> None:
    _, project = await _project(client, fake_github, jenkins_job=None)
    assert project["jenkins_job"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("job", ["../etc", "a//b", "/abs", "a/..", "has space", "a?b"])
async def test_unsafe_jenkins_job_names_are_rejected(
    client: AsyncClient,
    jenkins: FakeJenkinsClient,
    fake_github: FakeGitHubClient,
    job: str,
) -> None:
    token, project = await _project(client, fake_github, jenkins_job=None)
    response = await client.patch(
        f"/projects/{project['id']}",
        json={"jenkins_job": job},
        headers=auth_header(token),
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_build_without_jenkins_job_returns_409(
    client: AsyncClient,
    jenkins: FakeJenkinsClient,
    fake_github: FakeGitHubClient,
) -> None:
    token, project = await _project(client, fake_github, jenkins_job=None)
    response = await client.post(
        f"/projects/{project['id']}/builds", headers=auth_header(token)
    )
    assert response.status_code == 409


# --- trigger and follow a build ---------------------------------------------------


@pytest.mark.asyncio
async def test_trigger_build_then_follow_it_to_completion(
    client: AsyncClient,
    jenkins: FakeJenkinsClient,
    fake_github: FakeGitHubClient,
) -> None:
    token, project = await _project(client, fake_github)
    base = f"/projects/{project['id']}/builds"

    triggered = await client.post(base, headers=auth_header(token))
    assert triggered.status_code == 202, triggered.text
    queue_id = triggered.json()["queue_id"]
    # A public repo: no credentials pushed or sent.
    assert jenkins.params[queue_id] == {
        "GIT_REPO_URL": f"https://github.com/{project['repo_full_name']}.git",
        "GIT_BRANCH": project["branch"],
    }
    assert jenkins.credentials == {}

    queued = await client.get(f"{base}/queue/{queue_id}", headers=auth_header(token))
    assert queued.json() == {
        "queue_id": queue_id,
        "state": "queued",
        "build_number": None,
        "reason": "Waiting for next available executor",
    }

    number = jenkins.start(queue_id, "my-app")
    started = await client.get(f"{base}/queue/{queue_id}", headers=auth_header(token))
    assert started.json()["state"] == "started"
    assert started.json()["build_number"] == number

    running = await client.get(f"{base}/{number}", headers=auth_header(token))
    assert running.json()["status"] == "running"

    jenkins.jobs["my-app"][0] = make_build(number, result="FAILURE")
    finished = await client.get(f"{base}/{number}", headers=auth_header(token))
    assert finished.json()["status"] == "failure"
    assert finished.json()["duration_ms"] == 42_000


@pytest.mark.asyncio
async def test_list_builds_newest_first(
    client: AsyncClient,
    jenkins: FakeJenkinsClient,
    fake_github: FakeGitHubClient,
) -> None:
    jenkins.jobs["my-app"] = [make_build(3, None), make_build(2, "ABORTED"), make_build(1)]
    token, project = await _project(client, fake_github)

    response = await client.get(
        f"/projects/{project['id']}/builds",
        params={"limit": 2},
        headers=auth_header(token),
    )
    assert response.status_code == 200
    assert [(b["number"], b["status"]) for b in response.json()] == [
        (3, "running"),
        (2, "aborted"),
    ]


@pytest.mark.asyncio
async def test_build_log_is_plain_text(
    client: AsyncClient,
    jenkins: FakeJenkinsClient,
    fake_github: FakeGitHubClient,
) -> None:
    jenkins.jobs["my-app"] = [make_build(1)]
    jenkins.logs[("my-app", 1)] = "Started by user devflow\nFinished: SUCCESS\n"
    token, project = await _project(client, fake_github)

    response = await client.get(
        f"/projects/{project['id']}/builds/1/log", headers=auth_header(token)
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain")
    assert response.text.endswith("Finished: SUCCESS\n")


@pytest.mark.asyncio
async def test_unknown_build_returns_404(
    client: AsyncClient,
    jenkins: FakeJenkinsClient,
    fake_github: FakeGitHubClient,
) -> None:
    token, project = await _project(client, fake_github)
    base = f"/projects/{project['id']}/builds"
    for path in (f"{base}/7", f"{base}/7/log", f"{base}/queue/7"):
        response = await client.get(path, headers=auth_header(token))
        assert response.status_code == 404, path


@pytest.mark.asyncio
async def test_queue_item_of_another_job_is_hidden(
    client: AsyncClient,
    jenkins: FakeJenkinsClient,
    fake_github: FakeGitHubClient,
) -> None:
    jenkins.jobs["other-app"] = []
    other_queue_id = await jenkins.trigger_build("other-app")
    token, project = await _project(client, fake_github)

    response = await client.get(
        f"/projects/{project['id']}/builds/queue/{other_queue_id}",
        headers=auth_header(token),
    )
    assert response.status_code == 404


# --- errors -------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_job_missing_on_jenkins_returns_422(
    client: AsyncClient,
    jenkins: FakeJenkinsClient,
    fake_github: FakeGitHubClient,
) -> None:
    token, project = await _project(client, fake_github, jenkins_job="deleted-job")
    trigger = await client.post(
        f"/projects/{project['id']}/builds", headers=auth_header(token)
    )
    listed = await client.get(f"/projects/{project['id']}/builds", headers=auth_header(token))
    assert trigger.status_code == 422
    assert listed.status_code == 422


@pytest.mark.asyncio
async def test_jenkins_down_returns_502(
    client: AsyncClient,
    jenkins: FakeJenkinsClient,
    fake_github: FakeGitHubClient,
) -> None:
    token, project = await _project(client, fake_github)
    jenkins.unavailable = True
    response = await client.post(
        f"/projects/{project['id']}/builds", headers=auth_header(token)
    )
    assert response.status_code == 502


@pytest.mark.asyncio
async def test_jenkins_not_configured_returns_503(
    client: AsyncClient,
    fake_github: FakeGitHubClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.core.config import get_settings

    fake_github.repos = [make_repo(101, "octocat/hello-world")]
    token, project = await _project(client, fake_github)
    monkeypatch.setattr(get_settings(), "jenkins_token", None)

    response = await client.get(
        f"/projects/{project['id']}/builds", headers=auth_header(token)
    )
    assert response.status_code == 503


# --- private repositories -------------------------------------------------------------


@pytest.mark.asyncio
async def test_private_repo_build_stores_owners_github_token_in_jenkins(
    client: AsyncClient,
    jenkins: FakeJenkinsClient,
    fake_github: FakeGitHubClient,
) -> None:
    fake_github.repos = [make_repo(101, "octocat/hello-world", private=True)]
    token, project = await _project(client, fake_github)
    assert project["is_private"] is True
    owner_id = await user_id(client, token)

    triggered = await client.post(
        f"/projects/{project['id']}/builds", headers=auth_header(token)
    )
    assert triggered.status_code == 202, triggered.text

    credential_id = f"devflow-github-{owner_id}"
    # The token is in Jenkins' credential store; the build only gets its id.
    assert jenkins.credentials == {credential_id: ("octocat", "gho_dev@example.com")}
    assert jenkins.params[triggered.json()["queue_id"]] == {
        "GIT_REPO_URL": "https://github.com/octocat/hello-world.git",
        "GIT_BRANCH": "main",
        "GIT_CREDENTIALS_ID": credential_id,
    }


@pytest.mark.asyncio
async def test_private_repo_build_with_revoked_github_token_returns_409(
    client: AsyncClient,
    jenkins: FakeJenkinsClient,
    fake_github: FakeGitHubClient,
) -> None:
    fake_github.repos = [make_repo(101, "octocat/hello-world", private=True)]
    token, project = await _project(client, fake_github)
    fake_github.invalid_tokens.add("gho_dev@example.com")

    response = await client.post(
        f"/projects/{project['id']}/builds", headers=auth_header(token)
    )
    assert response.status_code == 409
    assert "reconnect" in response.json()["detail"]
    assert jenkins.credentials == {}
    assert jenkins.queue == {}


@pytest.mark.asyncio
async def test_private_repo_build_with_jenkins_down_returns_502(
    client: AsyncClient,
    jenkins: FakeJenkinsClient,
    fake_github: FakeGitHubClient,
) -> None:
    fake_github.repos = [make_repo(101, "octocat/hello-world", private=True)]
    token, project = await _project(client, fake_github)
    jenkins.unavailable = True

    response = await client.post(
        f"/projects/{project['id']}/builds", headers=auth_header(token)
    )
    assert response.status_code == 502


# --- access ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_builds_of_someone_elses_project_return_404(
    client: AsyncClient,
    jenkins: FakeJenkinsClient,
    fake_github: FakeGitHubClient,
) -> None:
    _, project = await _project(client, fake_github)
    stranger = await register_user(client, "stranger@example.com")

    response = await client.post(
        f"/projects/{project['id']}/builds", headers=auth_header(stranger)
    )
    assert response.status_code == 404
    assert jenkins.queue == {}


@pytest.mark.asyncio
async def test_teammate_can_watch_but_not_trigger_builds(
    client: AsyncClient,
    jenkins: FakeJenkinsClient,
    fake_github: FakeGitHubClient,
    db_session: AsyncSession,
) -> None:
    jenkins.jobs["my-app"] = [make_build(1)]
    _, project = await _project(
        client, fake_github, email="owner@example.com", company_name="Acme"
    )
    teammate = await register_user(client, "mate@example.com")
    mate_id = await db_session.scalar(select(User.id).where(User.email == "mate@example.com"))
    await db_session.execute(
        insert(user_teams).values(user_id=mate_id, team_id=uuid.UUID(project["team_id"]))
    )
    await db_session.commit()

    base = f"/projects/{project['id']}/builds"
    watch = await client.get(f"{base}/1", headers=auth_header(teammate))
    trigger = await client.post(base, headers=auth_header(teammate))
    assert watch.status_code == 200
    assert trigger.status_code == 403
