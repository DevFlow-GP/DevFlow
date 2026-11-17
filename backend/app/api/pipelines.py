import uuid

from fastapi import APIRouter, Path, Query, status
from fastapi.responses import PlainTextResponse

from app.api.dependencies import CurrentUserDep, PipelineServiceDep
from app.integrations.jenkins import JenkinsBuild
from app.schemas.pipeline import Build, BuildQueued, QueuedBuild

router = APIRouter(prefix="/projects/{project_id}/builds", tags=["builds"])


def _to_schema(build: JenkinsBuild) -> Build:
    return Build(
        number=build.number,
        status="running" if build.result is None else build.result.lower(),
        started_at=build.started_at,
        duration_ms=build.duration_ms,
        url=build.url,
    )


@router.post("", status_code=status.HTTP_202_ACCEPTED, response_model=BuildQueued)
async def trigger_build(
    project_id: uuid.UUID,
    current_user: CurrentUserDep,
    pipelines: PipelineServiceDep,
) -> BuildQueued:
    """Start a build of the project's Jenkins job.

    Jenkins queues it first, so there's no build number yet: poll
    `GET /projects/{project_id}/builds/queue/{queue_id}` for it.
    """
    queue_id = await pipelines.trigger_build(current_user, project_id)
    return BuildQueued(queue_id=queue_id)


@router.get("/queue/{queue_id}", response_model=QueuedBuild)
async def get_queued_build(
    project_id: uuid.UUID,
    current_user: CurrentUserDep,
    pipelines: PipelineServiceDep,
    queue_id: int = Path(ge=1),
) -> QueuedBuild:
    """404 once Jenkins forgets the item, a few minutes after the build starts."""
    item = await pipelines.get_queued_build(current_user, project_id, queue_id)
    if item.cancelled:
        state = "cancelled"
    elif item.build_number is not None:
        state = "started"
    else:
        state = "queued"
    return QueuedBuild(
        queue_id=item.id,
        state=state,
        build_number=item.build_number,
        reason=item.why,
    )


@router.get("", response_model=list[Build])
async def list_builds(
    project_id: uuid.UUID,
    current_user: CurrentUserDep,
    pipelines: PipelineServiceDep,
    limit: int = Query(default=20, ge=1, le=100),
) -> list[Build]:
    """The most recent builds, newest first."""
    builds = await pipelines.list_builds(current_user, project_id, limit=limit)
    return [_to_schema(build) for build in builds]


@router.get("/{number}", response_model=Build)
async def get_build(
    project_id: uuid.UUID,
    current_user: CurrentUserDep,
    pipelines: PipelineServiceDep,
    number: int = Path(ge=1),
) -> Build:
    """Poll this while `status` is "running"."""
    return _to_schema(await pipelines.get_build(current_user, project_id, number))


@router.get("/{number}/log", response_class=PlainTextResponse)
async def get_build_log(
    project_id: uuid.UUID,
    current_user: CurrentUserDep,
    pipelines: PipelineServiceDep,
    number: int = Path(ge=1),
) -> str:
    """The build's console output so far, as plain text."""
    return await pipelines.get_build_log(current_user, project_id, number)
