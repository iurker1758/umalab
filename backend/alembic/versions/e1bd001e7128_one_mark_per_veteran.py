"""one mark per veteran

A veteran carries at most one mark, matching the game (a trained uma has a
single favorite mark) and the PR 3 card badge. Keep only the newest mark per
veteran (highest id — rows insert sequentially), then swap the composite
unique for one on trained_chara_id alone so the DB enforces it.

Revision ID: e1bd001e7128
Revises: 4731b966f3a7
Create Date: 2026-07-29 06:18:29.834159

"""
from alembic import op

# revision identifiers, used by Alembic.
revision = 'e1bd001e7128'
down_revision = '4731b966f3a7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "DELETE FROM veteran_tags WHERE id NOT IN "
        "(SELECT max(id) FROM veteran_tags GROUP BY trained_chara_id)"
    )
    op.drop_constraint("uq_veteran_tag", "veteran_tags")
    op.create_unique_constraint(
        "uq_veteran_tag_trained_chara_id", "veteran_tags", ["trained_chara_id"]
    )


def downgrade() -> None:
    # The surplus marks deleted in upgrade() are not recoverable.
    op.drop_constraint("uq_veteran_tag_trained_chara_id", "veteran_tags")
    op.create_unique_constraint(
        "uq_veteran_tag", "veteran_tags", ["trained_chara_id", "tag"]
    )
