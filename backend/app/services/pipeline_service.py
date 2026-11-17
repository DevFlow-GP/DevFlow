import uuid

from app.core.exceptions import (
    BuildNotFoundError,
    JenkinsJobNotFoundError,
    JenkinsJobNotSetError,
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


class PipelineService:
    """Runs and watches a project's builds on Jenkins.

    Jenkins is the source of truth for build state; nothing is stored here yet.
    """

    def __init__(self, projects: ProjectRepository, jenkins: JenkinsClient) -> None:
        self._projects = projects
        self._jenkins = jenkins

    async def trigger_build(self, user: User, project_id: uuid.UUID) -> int:
        """Queue a build of the project's job; returns the Jenkins queue item id."""
        project = await self._get(user, project_id)
        # Teammates can watch builds; only the owner can start one.
        if project.owner_id != user.id:
            raise PermissionDeniedError()
        job = self._job(project)
        try:
            queue_id = await self._jenkins.trigger_build(job)
        except JenkinsError as exc:
            raise JenkinsUnavailableError() from exc
        if queue_id is None:
            raise JenkinsJobNotFoundError()
        return queue_id

    async def get_queued_build(
        self,
        user: User,
        project_id: uuid.UUID,
        queue_id: int,
    ) -> JenkinsQueueItem:
        job = self._job(await self._get(user, project_id))
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
        job = self._job(await self._get(user, project_id))
        try:
            builds = await self._jenkins.list_builds(job, limit=limit)
        except JenkinsError as exc:
            raise JenkinsUnavailableError() from exc
        if builds is None:
            raise JenkinsJobNotFoundError()
        return builds

    async def get_build(self, user: User, project_id: uuid.UUID, number: int) -> JenkinsBuild:
        job = self._job(await self._get(user, project_id))
        try:
            build = await self._jenkins.get_build(job, number)
        except JenkinsError as exc:
            raise JenkinsUnavailableError() from exc
        if build is None:
            raise BuildNotFoundError()
        return build

    async def get_build_log(self, user: User, project_id: uuid.UUID, number: int) -> str:
        job = self._job(await self._get(user, project_id))
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

    @staticmethod
    def _job(project: Project) -> str:
        if project.jenkins_job is None:
            raise JenkinsJobNotSetError()
        return project.jenkins_job
