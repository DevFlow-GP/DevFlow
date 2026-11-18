import uuid
from collections.abc import Awaitable, Callable
from typing import Annotated

from fastapi import BackgroundTasks, Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_session
from app.core.exceptions import (
    GitHubNotConfiguredError,
    InactiveUserError,
    InvalidTokenError,
    JenkinsNotConfiguredError,
    NotAuthenticatedError,
    PermissionDeniedError,
)
from app.core.security import decode_access_token, issued_before
from app.integrations.email import ConsoleEmailSender, EmailSender, SmtpEmailSender
from app.integrations.github import GitHubClient
from app.integrations.jenkins import JenkinsClient
from app.models.user import User, UserRole
from app.repositories.github_connection_repository import GitHubConnectionRepository
from app.repositories.project_repository import ProjectRepository
from app.repositories.user_repository import UserRepository
from app.services.account_email_service import AccountEmailService
from app.services.github_service import GitHubService
from app.services.pipeline_service import PipelineService

SessionDep = Annotated[AsyncSession, Depends(get_session)]

# auto_error=False so a missing header goes through our own 401 error format.
# Also adds the "Authorize" button (paste the access_token) to /docs.
_bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    session: SessionDep,
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)
    ],
) -> User:
    if credentials is None:
        raise NotAuthenticatedError()

    payload = decode_access_token(credentials.credentials)
    try:
        user_id = uuid.UUID(payload["sub"])
    except (KeyError, TypeError, ValueError) as exc:
        raise InvalidTokenError() from exc

    user = await UserRepository(session).get_by_id(user_id)
    if user is None:
        raise InvalidTokenError()
    # Changing or resetting the password signs out every earlier token.
    if issued_before(payload, user.password_changed_at):
        raise InvalidTokenError()
    if not user.is_active:
        raise InactiveUserError()
    return user


CurrentUserDep = Annotated[User, Depends(get_current_user)]


def require_roles(*roles: UserRole) -> Callable[[User], Awaitable[User]]:
    """Dependency factory: `Depends(require_roles(UserRole.admin))`.

    Checks the role stored in the database, not the one in the token, so a role
    change takes effect immediately.
    """

    async def checker(user: CurrentUserDep) -> User:
        if user.role not in roles:
            raise PermissionDeniedError()
        return user

    return checker


def get_github_client() -> GitHubClient:
    """Overridden with a fake in tests."""
    settings = get_settings()
    client_id = settings.github_client_id
    client_secret = settings.github_client_secret
    if not (client_id and client_secret and settings.github_token_encryption_key):
        raise GitHubNotConfiguredError()
    return GitHubClient(
        client_id=client_id,
        client_secret=client_secret,
        redirect_uri=settings.github_redirect_uri,
    )


def get_github_service(
    session: SessionDep,
    client: Annotated[GitHubClient, Depends(get_github_client)],
) -> GitHubService:
    return GitHubService(
        GitHubConnectionRepository(session),
        UserRepository(session),
        client,
    )


GitHubServiceDep = Annotated[GitHubService, Depends(get_github_service)]


def get_optional_github_client() -> GitHubClient | None:
    """Like get_github_client, but None when GitHub isn't configured, for
    features that only need GitHub if it's there (account deletion)."""
    try:
        return get_github_client()
    except GitHubNotConfiguredError:
        return None


def get_optional_github_service(
    session: SessionDep,
    client: Annotated[GitHubClient | None, Depends(get_optional_github_client)],
) -> GitHubService | None:
    if client is None:
        return None
    return GitHubService(GitHubConnectionRepository(session), UserRepository(session), client)


OptionalGitHubServiceDep = Annotated[
    GitHubService | None, Depends(get_optional_github_service)
]


def get_jenkins_client() -> JenkinsClient:
    """Overridden with a fake in tests."""
    settings = get_settings()
    url, user, token = settings.jenkins_url, settings.jenkins_user, settings.jenkins_token
    if not (url and user and token):
        raise JenkinsNotConfiguredError()
    return JenkinsClient(url=url, user=user, token=token)


def get_optional_jenkins_client() -> JenkinsClient | None:
    """Like get_jenkins_client, but None when Jenkins isn't configured, for
    features that only need Jenkins if it's there (deleting a project's job)."""
    try:
        return get_jenkins_client()
    except JenkinsNotConfiguredError:
        return None


def get_pipeline_service(
    session: SessionDep,
    jenkins: Annotated[JenkinsClient, Depends(get_jenkins_client)],
    github: OptionalGitHubServiceDep,
) -> PipelineService:
    return PipelineService(ProjectRepository(session), jenkins, github)


PipelineServiceDep = Annotated[PipelineService, Depends(get_pipeline_service)]


def get_email_sender() -> EmailSender:
    """Overridden with a fake in tests."""
    settings = get_settings()
    if settings.email_backend == "smtp":
        return SmtpEmailSender(settings)
    return ConsoleEmailSender()


def get_account_email_service(
    background_tasks: BackgroundTasks,
    sender: Annotated[EmailSender, Depends(get_email_sender)],
) -> AccountEmailService:
    return AccountEmailService(sender, background_tasks)


AccountEmailServiceDep = Annotated[AccountEmailService, Depends(get_account_email_service)]
