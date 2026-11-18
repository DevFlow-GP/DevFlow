import logging
import uuid

from sqlalchemy.exc import IntegrityError

from app.core.exceptions import (
    PermissionDeniedError,
    ProjectAlreadyExistsError,
    ProjectNotFoundError,
)
from app.integrations.jenkins import JenkinsClient, JenkinsError
from app.models.project import Project
from app.models.user import User
from app.repositories.project_repository import ProjectRepository
from app.schemas.project import ProjectCreate, ProjectUpdate
from app.services.github_service import GitHubService
from app.services.jenkins_jobs import job_name, pipeline_for_language

logger = logging.getLogger(__name__)


class ProjectService:
    """Projects: a GitHub repository registered on DevFlow for deployment."""

    def __init__(
        self,
        projects: ProjectRepository,
        jenkins: JenkinsClient | None = None,
    ) -> None:
        self._projects = projects
        # None when Jenkins isn't configured; projects work without it.
        self._jenkins = jenkins

    async def create(
        self,
        owner: User,
        payload: ProjectCreate,
        github: GitHubService,
    ) -> Project:
        # Confirms the repo exists and the owner's GitHub access level allows it.
        repo = await github.get_repository(owner, payload.repo_full_name)
        if await self._projects.get_by_owner_and_repo(owner.id, repo.id) is not None:
            raise ProjectAlreadyExistsError()
        branch = payload.branch or repo.default_branch
        await github.ensure_branch_exists(owner, repo, branch)

        description = (
            payload.description
            if "description" in payload.model_fields_set
            else repo.description
        )
        project = Project(
            name=payload.name or repo.name,
            description=description,
            repo_url=repo.html_url,
            github_repo_id=repo.id,
            repo_full_name=repo.full_name,
            default_branch=repo.default_branch,
            branch=branch,
            is_private=repo.private,
            pipeline=payload.pipeline or pipeline_for_language(repo.language),
            owner_id=owner.id,
            team_id=await self._projects.first_team_id(owner.id),
        )
        try:
            return await self._projects.save(project)
        except IntegrityError as exc:
            raise ProjectAlreadyExistsError() from exc

    async def list_for(self, user: User) -> list[Project]:
        return await self._projects.list_visible(user.id)

    async def get(self, user: User, project_id: uuid.UUID) -> Project:
        project = await self._projects.get_visible(project_id, user.id)
        if project is None:
            raise ProjectNotFoundError()
        return project

    async def update(
        self,
        user: User,
        project_id: uuid.UUID,
        payload: ProjectUpdate,
        github: GitHubService,
    ) -> Project:
        project = await self._get_owned(user, project_id)
        # ProjectUpdate rejects `branch: null`, so None here means "not sent".
        if payload.branch is not None and payload.branch != project.branch:
            # Re-fetch the repo: access may have changed since the project was created.
            repo = await github.get_repository(user, project.repo_full_name)
            await github.ensure_branch_exists(user, repo, payload.branch)
        # The job lives in its template's folder, so a new pipeline means a new job.
        # The next build creates it.
        if payload.pipeline is not None and payload.pipeline != project.pipeline:
            await self._delete_job(project)  # before the change: job_name reads pipeline
            project.jenkins_job = None
        for field in payload.model_fields_set:
            setattr(project, field, getattr(payload, field))
        return await self._projects.save(project)

    async def delete(self, user: User, project_id: uuid.UUID) -> None:
        project = await self._get_owned(user, project_id)
        await self._delete_job(project)
        await self._projects.delete(project)

    async def _delete_job(self, project: Project) -> None:
        """Best effort: a Jenkins outage must not block changing or deleting a project.

        Only touches a job DevFlow created, never one linked by hand.
        """
        if self._jenkins is None or project.jenkins_job != job_name(project):
            return
        try:
            await self._jenkins.delete_job(project.jenkins_job)
        except JenkinsError as exc:
            logger.warning(
                "Could not delete Jenkins job %s of project %s: %s",
                project.jenkins_job,
                project.id,
                exc,
            )

    async def _get_owned(self, user: User, project_id: uuid.UUID) -> Project:
        # Teammates can view a project; only its owner can change or delete it.
        project = await self.get(user, project_id)
        if project.owner_id != user.id:
            raise PermissionDeniedError()
        return project
