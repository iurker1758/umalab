"""spark lists: updated_at in, position out

The management page (issue #70) shipped its reorder control to review and
lost it there: nothing curates an order by hand, the page offers SORTS
instead — name, newest, last edited (DECISIONS.md #44). `updated_at` is
what the last-edited sort reads; `position` goes because no shipped UI ever
set one, so every row still holds the create-time append value and the
column is `id` order wearing a second name.

The backfill is one shared now() for every existing row — the table never
recorded edits, so there is no history to restore; pre-migration rows tie
and the client's Last Edited sort degrades to creation order among them
until a row is actually edited.

The downgrade restores the column with its old default; the values it held
were derivable (creation order), so nothing is owed back.

Revision ID: e6a8d34f19c2
Revises: a7c4e2b91f55
Create Date: 2026-08-10 00:00:00.000000

"""
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = 'e6a8d34f19c2'
down_revision = 'a7c4e2b91f55'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "spark_lists",
        sa.Column(
            "updated_at",
            sa.DateTime(),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.drop_column("spark_lists", "position")


def downgrade() -> None:
    op.add_column(
        "spark_lists",
        sa.Column(
            "position", sa.Integer(), server_default=sa.text("0"), nullable=False
        ),
    )
    op.drop_column("spark_lists", "updated_at")
