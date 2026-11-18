import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import SessionLocal
from app.integrations.jenkins import JenkinsError, job_path
from app.models.project import Pipeline, Project
from app.models.team import user_teams
from app.models.user import User
from app.services.jenkins_jobs import JOB_CONFIG_XML, pipeline_for_language
from tests.conftest import auth_header, connect_github, register_user, user_id
from tests.fakes import FakeGitHubClient, FakeJenkinsClient, make_build, make_repo


@pytest.fixture
def jenkins(fake_github: FakeGitHubClient, fake_jenkins: FakeJenkinsClient) -> FakeJenkinsClient:
    fake_github.repos = [make_repo(101, "octocat/hello-world")]
    return fake_jenkins


async def _project(
    client: AsyncClient,
    fake_github: FakeGitHubClient,
    *,
    email: str = "dev@example.com",
    repo: str = "octocat/hello-world",
    **register_overrides: str,
) -> tuple[str, dict]:
    """A user with a (never built) project; returns (token, project)."""
    token = await register_user(client, email, **register_overrides)
    await connect_github(client, fake_github, token, github_token=f"gho_{email}", code=email)
    created = await client.post(
        "/projects", json={"repo_full_name": repo}, headers=auth_header(token)
    )
    assert created.status_code == 201, created.text
    return token, created.json()


def _job(project: dict) -> str:
    return f"user-apps/{project['pipeline']}/{project['id']}"


async def _trigger(client: AsyncClient, token: str, project: dict) -> int:
    response = await client.post(f"/projects/{project['id']}/builds", headers=auth_header(token))
    assert response.status_code == 202, response.text
    return response.json()["queue_id"]


async def _get_project(client: AsyncClient, token: str, project: dict) -> dict:
    response = await client.get(f"/projects/{project['id']}", headers=auth_header(token))
    assert response.status_code == 200, response.text
    return response.json()


async def _link(project: dict, job: str) -> None:
    """Point the project at `job` directly; the API can't (DevFlow names its jobs)."""
    async with SessionLocal() as session:
        await session.execute(
            update(Project).where(Project.id == uuid.UUID(project["id"])).values(jenkins_job=job)
        )
        await session.commit()


def test_job_path_nests_folders_and_escapes_names() -> None:
    assert job_path("my-app") == "/job/my-app/"
    assert job_path("team/my app") == "/job/team/job/my%20app/"


def test_pipeline_for_language() -> None:
    assert pipeline_for_language("Python") is Pipeline.python
    assert pipeline_for_language("TypeScript") is Pipeline.node
    assert pipeline_for_language("Haskell") is Pipeline.dockerfile
    assert pipeline_for_language(None) is Pipeline.dockerfile


# --- job lifecycle ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_first_build_creates_the_job(
    client: AsyncClient,
    jenkins: FakeJenkinsClient,
    fake_github: FakeGitHubClient,
) -> None:
    token, project = await _project(client, fake_github)
    assert project["jenkins_job"] is None
    job = f"user-apps/python/{project['id']}"

    queue_id = await _trigger(client, token, project)

    assert job in jenkins.jobs
    assert jenkins.created_configs[job] == JOB_CONFIG_XML
    assert jenkins.queue[queue_id].job_path == job_path(job)
    assert (await _get_project(client, token, project))["jenkins_job"] == job


@pytest.mark.asyncio
async def test_second_build_reuses_the_job(
    client: AsyncClient,
    jenkins: FakeJenkinsClient,
    fake_github: FakeGitHubClient,
) -> None:
    token, project = await _project(client, fake_github)
    first = await _trigger(client, token, project)
    jenkins.start(first, _job(project))
    second = await _trigger(client, token, project)
    jenkins.start(second, _job(project))

    assert jenkins.create_calls == [_job(project)]
    assert [b.number for b in jenkins.jobs[_job(project)]] == [2, 1]


@pytest.mark.asyncio
async def test_job_deleted_on_jenkins_is_recreated(
    client: AsyncClient,
    jenkins: FakeJenkinsClient,
    fake_github: FakeGitHubClient,
) -> None:
    token, project = await _project(client, fake_github)
    await _trigger(client, token, project)
    del jenkins.jobs[_job(project)]

    # Until the next build, the project just has no builds.
    listed = await client.get(f"/projects/{project['id']}/builds", headers=auth_header(token))
    assert listed.status_code == 200
    assert listed.json() == []

    await _trigger(client, token, project)
    assert jenkins.create_calls == [_job(project), _job(project)]
    assert _job(project) in jenkins.jobs


@pytest.mark.asyncio
async def test_missing_folder_returns_503(
    client: AsyncClient,
    jenkins: FakeJenkinsClient,
    fake_github: FakeGitHubClient,
) -> None:
    fake_github.repos = [make_repo(101, "octocat/hello-world", language="Go")]
    jenkins.folders.discard("user-apps/go")
    token, project = await _project(client, fake_github)

    response = await client.post(f"/projects/{project['id']}/builds", headers=auth_header(token))
    assert response.status_code == 503
    assert "user-apps/go" in response.json()["detail"]
    assert jenkins.queue == {}
    assert (await _get_project(client, token, project))["jenkins_job"] is None


@pytest.mark.asyncio
async def test_failed_trigger_keeps_the_created_job(
    client: AsyncClient,
    jenkins: FakeJenkinsClient,
    fake_github: FakeGitHubClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    token, project = await _project(client, fake_github)

    async def trigger_fails(job: str, params: dict[str, str] | None = None) -> int | None:
        raise JenkinsError("Could not reach Jenkins")

    monkeypatch.setattr(jenkins, "trigger_build", trigger_fails)
    response = await client.post(f"/projects/{project['id']}/builds", headers=auth_header(token))
    assert response.status_code == 502
    # The job was created and saved; the retry reuses it.
    assert (await _get_project(client, token, project))["jenkins_job"] == _job(project)
    assert jenkins.create_calls == [_job(project)]


# --- trigger and follow a build ---------------------------------------------------


@pytest.mark.asyncio
async def test_trigger_build_then_follow_it_to_completion(
    client: AsyncClient,
    jenkins: FakeJenkinsClient,
    fake_github: FakeGitHubClient,
) -> None:
    token, project = await _project(client, fake_github)
    base = f"/projects/{project['id']}/builds"

    queue_id = await _trigger(client, token, project)
    job = _job(project)
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

    number = jenkins.start(queue_id, job)
    started = await client.get(f"{base}/queue/{queue_id}", headers=auth_header(token))
    assert started.json()["state"] == "started"
    assert started.json()["build_number"] == number

    running = await client.get(f"{base}/{number}", headers=auth_header(token))
    assert running.json()["status"] == "running"

    jenkins.jobs[job][0] = make_build(number, result="FAILURE")
    finished = await client.get(f"{base}/{number}", headers=auth_header(token))
    assert finished.json()["status"] == "failure"
    assert finished.json()["duration_ms"] == 42_000


@pytest.mark.asyncio
async def test_list_builds_newest_first(
    client: AsyncClient,
    jenkins: FakeJenkinsClient,
    fake_github: FakeGitHubClient,
) -> None:
    token, project = await _project(client, fake_github)
    await _trigger(client, token, project)
    jenkins.jobs[_job(project)] = [make_build(3, None), make_build(2, "ABORTED"), make_build(1)]

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
async def test_list_builds_before_first_build_is_empty(
    client: AsyncClient,
    jenkins: FakeJenkinsClient,
    fake_github: FakeGitHubClient,
) -> None:
    token, project = await _project(client, fake_github)
    jenkins.unavailable = True  # proves Jenkins isn't asked

    response = await client.get(f"/projects/{project['id']}/builds", headers=auth_header(token))
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
async def test_build_log_is_plain_text(
    client: AsyncClient,
    jenkins: FakeJenkinsClient,
    fake_github: FakeGitHubClient,
) -> None:
    token, project = await _project(client, fake_github)
    number = jenkins.start(await _trigger(client, token, project), _job(project))
    jenkins.logs[(_job(project), number)] = "Started by user devflow\nFinished: SUCCESS\n"

    response = await client.get(
        f"/projects/{project['id']}/builds/{number}/log", headers=auth_header(token)
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain")
    assert response.text.endswith("Finished: SUCCESS\n")


@pytest.mark.asyncio
@pytest.mark.parametrize("built", [False, True])
async def test_unknown_build_returns_404(
    client: AsyncClient,
    jenkins: FakeJenkinsClient,
    fake_github: FakeGitHubClient,
    built: bool,
) -> None:
    token, project = await _project(client, fake_github)
    if built:
        await _trigger(client, token, project)
    base = f"/projects/{project['id']}/builds"
    for path in (f"{base}/7", f"{base}/7/log", f"{base}/queue/7"):
        response = await client.get(path, headers=auth_header(token))
        assert response.status_code == 404, path


@pytest.mark.asyncio
async def test_builds_are_separate_per_project(
    client: AsyncClient,
    jenkins: FakeJenkinsClient,
    fake_github: FakeGitHubClient,
) -> None:
    fake_github.repos = [make_repo(101, "octocat/hello-world"), make_repo(102, "octocat/api")]
    token, a = await _project(client, fake_github)
    created = await client.post(
        "/projects", json={"repo_full_name": "octocat/api"}, headers=auth_header(token)
    )
    b = created.json()

    a_queue = await _trigger(client, token, a)
    jenkins.start(a_queue, _job(a))
    b_queue = await _trigger(client, token, b)
    b_number = jenkins.start(b_queue, _job(b))
    jenkins.jobs[_job(b)][0] = make_build(b_number, result="FAILURE")
    jenkins.logs[(_job(b), b_number)] = "B's log"

    for project, status in ((a, "running"), (b, "failure")):
        listed = await client.get(f"/projects/{project['id']}/builds", headers=auth_header(token))
        assert [(x["number"], x["status"]) for x in listed.json()] == [(1, status)]

    # Both builds are #1, but A's endpoints only ever read A's job.
    a_log = await client.get(f"/projects/{a['id']}/builds/1/log", headers=auth_header(token))
    a_queue_view = await client.get(
        f"/projects/{a['id']}/builds/queue/{b_queue}", headers=auth_header(token)
    )
    assert a_log.status_code == 404
    assert a_queue_view.status_code == 404


# --- errors -------------------------------------------------------------------------


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


# --- changing and deleting projects ----------------------------------------------------


@pytest.mark.asyncio
async def test_changing_pipeline_deletes_old_job(
    client: AsyncClient,
    jenkins: FakeJenkinsClient,
    fake_github: FakeGitHubClient,
) -> None:
    token, project = await _project(client, fake_github)
    await _trigger(client, token, project)
    old_job = _job(project)

    patched = await client.patch(
        f"/projects/{project['id']}", json={"pipeline": "go"}, headers=auth_header(token)
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["jenkins_job"] is None
    assert jenkins.deleted_jobs == [old_job]

    await _trigger(client, token, patched.json())
    new_job = f"user-apps/go/{project['id']}"
    assert new_job in jenkins.jobs
    assert (await _get_project(client, token, project))["jenkins_job"] == new_job


@pytest.mark.asyncio
async def test_patch_with_same_pipeline_keeps_the_job(
    client: AsyncClient,
    jenkins: FakeJenkinsClient,
    fake_github: FakeGitHubClient,
) -> None:
    token, project = await _project(client, fake_github)
    await _trigger(client, token, project)

    patched = await client.patch(
        f"/projects/{project['id']}", json={"pipeline": "python"}, headers=auth_header(token)
    )
    assert patched.json()["jenkins_job"] == _job(project)
    assert jenkins.deleted_jobs == []


@pytest.mark.asyncio
async def test_deleting_project_deletes_its_job(
    client: AsyncClient,
    jenkins: FakeJenkinsClient,
    fake_github: FakeGitHubClient,
) -> None:
    token, project = await _project(client, fake_github)
    await _trigger(client, token, project)

    response = await client.delete(f"/projects/{project['id']}", headers=auth_header(token))
    assert response.status_code == 204
    assert jenkins.deleted_jobs == [_job(project)]


@pytest.mark.asyncio
async def test_deleting_never_built_project_makes_no_jenkins_call(
    client: AsyncClient,
    jenkins: FakeJenkinsClient,
    fake_github: FakeGitHubClient,
) -> None:
    token, project = await _project(client, fake_github)
    response = await client.delete(f"/projects/{project['id']}", headers=auth_header(token))
    assert response.status_code == 204
    assert jenkins.deleted_jobs == []


@pytest.mark.asyncio
async def test_deleting_project_with_jenkins_down_still_works(
    client: AsyncClient,
    jenkins: FakeJenkinsClient,
    fake_github: FakeGitHubClient,
) -> None:
    token, project = await _project(client, fake_github)
    await _trigger(client, token, project)
    jenkins.unavailable = True

    response = await client.delete(f"/projects/{project['id']}", headers=auth_header(token))
    assert response.status_code == 204
    gone = await client.get(f"/projects/{project['id']}", headers=auth_header(token))
    assert gone.status_code == 404


@pytest.mark.asyncio
async def test_deleting_project_never_deletes_unmanaged_job(
    client: AsyncClient,
    jenkins: FakeJenkinsClient,
    fake_github: FakeGitHubClient,
) -> None:
    jenkins.jobs["py-test"] = [make_build(1)]
    token, project = await _project(client, fake_github)
    await _link(project, "py-test")  # e.g. a hand-made job linked before migration 0006

    response = await client.delete(f"/projects/{project['id']}", headers=auth_header(token))
    assert response.status_code == 204
    assert jenkins.deleted_jobs == []
    assert "py-test" in jenkins.jobs


@pytest.mark.asyncio
async def test_deleting_project_works_without_jenkins_configured(
    client: AsyncClient,
    fake_github: FakeGitHubClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.core.config import get_settings

    fake_github.repos = [make_repo(101, "octocat/hello-world")]
    token, project = await _project(client, fake_github)
    monkeypatch.setattr(get_settings(), "jenkins_token", None)

    response = await client.delete(f"/projects/{project['id']}", headers=auth_header(token))
    assert response.status_code == 204


# --- private repositories -------------------------------------------------------------


@pytest.mark.asyncio
async def test_private_repo_build_on_new_job(
    client: AsyncClient,
    jenkins: FakeJenkinsClient,
    fake_github: FakeGitHubClient,
) -> None:
    fake_github.repos = [make_repo(101, "octocat/hello-world", private=True)]
    token, project = await _project(client, fake_github)
    assert project["is_private"] is True
    assert project["jenkins_job"] is None
    owner_id = await user_id(client, token)

    queue_id = await _trigger(client, token, project)

    credential_id = f"devflow-github-{owner_id}"
    assert _job(project) in jenkins.created_configs
    # The token is in Jenkins' credential store; the build only gets its id.
    assert jenkins.credentials == {credential_id: ("octocat", "gho_dev@example.com")}
    assert jenkins.params[queue_id] == {
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
    assert jenkins.create_calls == []


@pytest.mark.asyncio
async def test_teammate_can_watch_but_not_trigger_builds(
    client: AsyncClient,
    jenkins: FakeJenkinsClient,
    fake_github: FakeGitHubClient,
    db_session: AsyncSession,
) -> None:
    owner, project = await _project(
        client, fake_github, email="owner@example.com", company_name="Acme"
    )
    jenkins.start(await _trigger(client, owner, project), _job(project))
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
