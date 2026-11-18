import uuid

from app.core.exceptions import (
    BuildNotFoundError,
    GitHubNotConfiguredError,
    JenkinsPipelineNotSetUpError,
    JenkinsUnavailableError,
    PermissionDeniedError,
    ProjectNotFoundError,
)
from app.integrations.jenkins import (
    JenkinsBuild,
    JenkinsClient,
    JenkinsError,
    JenkinsQueueItem,
    job_path,
)
from app.models.project import Project
from app.models.user import User
from app.repositories.project_repository import ProjectRepository
from app.services.github_service import GitHubService
from app.services.jenkins_jobs import JOB_CONFIG_XML, job_name


def clone_credentials_id(user: User) -> str:
    """Jenkins credential holding `user`'s GitHub token; one per user, reused by their projects."""
    return f"devflow-github-{user.id}"


class PipelineService:
    """Runs and watches a project's builds on Jenkins.

    Each project gets its own job, created on its first build (see jenkins_jobs.py).
    Jenkins is the source of truth for build state; nothing else is stored here.
    """

    def __init__(
        self,
        projects: ProjectRepository,
        jenkins: JenkinsClient,
        github: GitHubService | None = None,
    ) -> None:
        self._projects = projects
        self._jenkins = jenkins
        # None when GitHub isn't configured; only private repos need it.
        self._github = github

    async def trigger_build(self, user: User, project_id: uuid.UUID) -> int:
        """Queue a build of the project's job; returns the Jenkins queue item id."""
        project = await self._get(user, project_id)
        # Teammates can watch builds; only the owner can start one.
        if project.owner_id != user.id:
            raise PermissionDeniedError()
        job = await self._ensure_job(project)
        params = self._build_params(project)
        if project.is_private:
            params["GIT_CREDENTIALS_ID"] = await self._push_clone_credentials(user, project)
        try:
            queue_id = await self._jenkins.trigger_build(job, params)
        except JenkinsError as exc:
            raise JenkinsUnavailableError() from exc
        # Only if the job was deleted on Jenkins in the moment since _ensure_job.
        if queue_id is None:
            raise JenkinsUnavailableError()
        return queue_id

    async def get_queued_build(
        self,
        user: User,
        project_id: uuid.UUID,
        queue_id: int,
    ) -> JenkinsQueueItem:
        job = (await self._get(user, project_id)).jenkins_job
        if job is None:
            raise BuildNotFoundError()
        try:
            item = await self._jenkins.get_queue_item(queue_id)
        except JenkinsError as exc:
            raise JenkinsUnavailableError() from exc
        # Queue ids are global on Jenkins; don't reveal another project's items.
        if item is None or not item.job_path.endswith(job_path(job)):
            raise BuildNotFoundError()
        return item

    async def list_builds(
        self,
        user: User,
        project_id: uuid.UUID,
        *,
        limit: int,
    ) -> list[JenkinsBuild]:
        job = (await self._get(user, project_id)).jenkins_job
        if job is None:  # never built
            return []
        try:
            builds = await self._jenkins.list_builds(job, limit=limit)
        except JenkinsError as exc:
            raise JenkinsUnavailableError() from exc
        # None: the job was deleted on Jenkins; the next build recreates it.
        return builds or []

    async def get_build(self, user: User, project_id: uuid.UUID, number: int) -> JenkinsBuild:
        job = (await self._get(user, project_id)).jenkins_job
        if job is None:
            raise BuildNotFoundError()
        try:
            build = await self._jenkins.get_build(job, number)
        except JenkinsError as exc:
            raise JenkinsUnavailableError() from exc
        if build is None:
            raise BuildNotFoundError()
        return build

    async def get_build_log(self, user: User, project_id: uuid.UUID, number: int) -> str:
        job = (await self._get(user, project_id)).jenkins_job
        if job is None:
            raise BuildNotFoundError()
        try:
            log = await self._jenkins.get_console_text(job, number)
        except JenkinsError as exc:
            raise JenkinsUnavailableError() from exc
        if log is None:
            raise BuildNotFoundError()
        return log

    async def _get(self, user: User, project_id: uuid.UUID) -> Project:
        project = await self._projects.get_visible(project_id, user.id)
        if project is None:
            raise ProjectNotFoundError()
        return project

    async def _ensure_job(self, project: Project) -> str:
        """Create the project's job if it doesn't exist (first build, or deleted by hand).

        The saved jenkins_job is kept even if the trigger then fails: the job exists.
        """
        job = job_name(project)
        try:
            if not await self._jenkins.job_exists(job):
                if not await self._jenkins.create_job(job, JOB_CONFIG_XML):
                    raise JenkinsPipelineNotSetUpError(project.pipeline)
        except JenkinsError as exc:
            raise JenkinsUnavailableError() from exc
        if project.jenkins_job != job:
            project.jenkins_job = job
            await self._projects.save(project)
        return job

    async def _push_clone_credentials(self, owner: User, project: Project) -> str:
        """Store the owner's current GitHub token in Jenkins; returns the credential id.

        Refreshed before every private build, so a reconnected GitHub account
        (new token) is picked up. The token goes into Jenkins' credential store,
        never into build parameters, which anyone who can see the job can read.
        """
        if self._github is None:
            raise GitHubNotConfiguredError()
        login, token = await self._github.get_clone_credentials(owner, project.repo_full_name)
        credential_id = clone_credentials_id(owner)
        try:
            await self._jenkins.put_credentials(
                credential_id,
                username=login,
                password=token,
                description=f"DevFlow: GitHub access of {login}",
            )
        except JenkinsError as exc:
            raise JenkinsUnavailableError() from exc
        return credential_id

    @staticmethod
    def _build_params(project: Project) -> dict[str, str]:
        """What the JTE user-app jobs check out (see JTE's git_checkout step).

        Every DevFlow job declares these parameters (JOB_CONFIG_XML), plus
        GIT_CREDENTIALS_ID, which trigger_build adds for private repos.
        """
        return {
            "GIT_REPO_URL": f"https://github.com/{project.repo_full_name}.git",
            "GIT_BRANCH": project.branch,
        }
