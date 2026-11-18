"""projects.pipeline: which JTE template builds the project

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-18

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

project_pipeline = sa.Enum("python", "node", "go", "dockerfile", name="project_pipeline")


def upgrade() -> None:
    project_pipeline.create(op.get_bind(), checkfirst=True)
    op.add_column("projects", sa.Column("pipeline", project_pipeline, nullable=True))
    # Existing projects predate language detection; a Dockerfile build is the
    # one that makes no assumption about the repo.
    op.execute("UPDATE projects SET pipeline = 'dockerfile'")
    op.alter_column("projects", "pipeline", nullable=False)
    # Jobs linked so far were made by hand. DevFlow only deletes jobs it created,
    # so forget them; the next build creates a managed job.
    op.execute("UPDATE projects SET jenkins_job = NULL")


def downgrade() -> None:
    op.drop_column("projects", "pipeline")
    project_pipeline.drop(op.get_bind(), checkfirst=True)
