"""purge non-mark tags

Tags became a fixed set of favorite-mark icon ids (DECISIONS.md #9); the
free-text rows written before this change were throwaway, so they are simply
deleted rather than mapped. Data-only migration — no schema change, and the
downgrade is a no-op (the deleted text is not recoverable and not wanted).

Revision ID: 4731b966f3a7
Revises: f99279d25b3c
Create Date: 2026-07-29 06:01:19.891314

"""
import json
from pathlib import Path

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '4731b966f3a7'
down_revision = 'f99279d25b3c'
branch_labels = None
depends_on = None

TAG_ICONS_FILE = Path(__file__).resolve().parents[2] / "app" / "data" / "tag_icons.json"


def upgrade() -> None:
    valid = json.loads(TAG_ICONS_FILE.read_text(encoding="utf-8"))
    op.execute(
        sa.text("DELETE FROM veteran_tags WHERE tag NOT IN :valid").bindparams(
            sa.bindparam("valid", expanding=True, value=valid)
        )
    )


def downgrade() -> None:
    pass
