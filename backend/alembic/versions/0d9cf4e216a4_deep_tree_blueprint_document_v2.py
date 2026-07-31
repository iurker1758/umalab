"""deep tree blueprint document v2

The designer's document moves from six keyed lineage slots to the 31-node
breadth-first tree (DECISIONS.md #25): `named` [0-6] + `sparks` [7-30].
Saved 6-slot blueprints are WIPED rather than migrated (confirmed ruling —
they carry no typed sparks, so a mapped copy would be an empty shell), and
the trainee moves into named[0] as a full slot (it needs a card_id for
per-card base letters), retiring the `trainee_chara_id` column.

Revision ID: 0d9cf4e216a4
Revises: 4b934be8d97e
Create Date: 2026-07-31 00:40:36.807137

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0d9cf4e216a4'
down_revision = '4b934be8d97e'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DELETE FROM blueprints")
    op.drop_column('blueprints', 'trainee_chara_id')


def downgrade() -> None:
    # The upgrade wipe is unrecoverable; downgrade restores only the shape.
    op.execute("DELETE FROM blueprints")
    op.add_column('blueprints', sa.Column('trainee_chara_id', sa.Integer(), nullable=True))
