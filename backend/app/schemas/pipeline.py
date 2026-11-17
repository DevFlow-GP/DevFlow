from datetime import datetime
from typing import Literal

from pydantic import BaseModel

# Jenkins' result, lowercased; "running" while Jenkins reports no result yet.
BuildStatus = Literal["running", "success", "failure", "unstable", "aborted", "not_built"]


class BuildQueued(BaseModel):
    """Poll GET /projects/{id}/builds/queue/{queue_id} until `build_number` is set."""

    queue_id: int


class QueuedBuild(BaseModel):
    queue_id: int
    # "queued": waiting for an executor; "started": `build_number` is set.
    state: Literal["queued", "started", "cancelled"]
    build_number: int | None
    # Jenkins' reason for waiting, e.g. "Waiting for next available executor".
    reason: str | None


class Build(BaseModel):
    number: int
    status: BuildStatus
    started_at: datetime
    # 0 while running.
    duration_ms: int
    # The build's page on Jenkins.
    url: str
