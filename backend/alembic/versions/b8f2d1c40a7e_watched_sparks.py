"""watched sparks

The one list of sparks a user cares about (DECISIONS.md #33, issue #39).
New table, no backfill: nothing existed to migrate — the shape shipped
briefly as a client-side store and was never persisted anywhere.

Unique per (owner, kind, key), matching the uniqueness rule the blueprint
`factors` document already uses. `id` order IS insertion order, which is
the order the chooser lists them in.

Revision ID: b8f2d1c40a7e
Revises: a3c71e5d9b04
Create Date: 2026-08-03 00:00:00.000000

"""
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision = 'b8f2d1c40a7e'
down_revision = 'a3c71e5d9b04'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "watched_sparks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("key", sa.Integer(), nullable=False),
        sa.Column(
            "hunting", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
        sa.Column(
            "groups",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["owner_id"], ["users.id"], name="fk_watched_sparks_owner_id_users",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "owner_id", "kind", "key", name="uq_watched_spark_owner_kind_key"
        ),
    )
    op.create_index("ix_watched_sparks_owner_id", "watched_sparks", ["owner_id"])


def downgrade() -> None:
    op.drop_index("ix_watched_sparks_owner_id", table_name="watched_sparks")
    op.drop_table("watched_sparks")
