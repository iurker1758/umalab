"""purge non-mark tags

Tags became a fixed set of favorite-mark icon ids (DECISIONS.md #9); the
free-text rows written before this change were throwaway, so they are simply
deleted rather than mapped. Data-only migration — no schema change, and the
downgrade is a no-op (the deleted text is not recoverable and not wanted).

The valid ids are embedded as a snapshot of app/data/tag_icons.json as of
this revision — migrations must not read live app data, or a later edit to
that file would silently change (or break) historical behavior on fresh
databases.

Revision ID: 4731b966f3a7
Revises: f99279d25b3c
Create Date: 2026-07-29 06:01:19.891314

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '4731b966f3a7'
down_revision = 'f99279d25b3c'
branch_labels = None
depends_on = None

VALID_TAGS = [f"mark_{n:02d}" for n in range(1, 16)]


def upgrade() -> None:
    op.execute(
        sa.text("DELETE FROM veteran_tags WHERE tag NOT IN :valid").bindparams(
            sa.bindparam("valid", expanding=True, value=VALID_TAGS)
        )
    )


def downgrade() -> None:
    pass
