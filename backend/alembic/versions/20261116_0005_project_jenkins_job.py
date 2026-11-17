"""projects.jenkins_job: the Jenkins job that builds the project

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-16

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("jenkins_job", sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column("projects", "jenkins_job")
