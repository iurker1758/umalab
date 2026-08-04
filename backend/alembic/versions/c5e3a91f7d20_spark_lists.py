"""spark lists replace watched sparks

The user's named lists of sparks they want (DECISIONS.md #37, issue #39),
replacing #33's single watched list with a `hunting` bit and a derived
group vocabulary. #37 holds why the axis was wrong.

NO BACKFILL, AND THE DROP IS DELIBERATE. `watched_sparks` goes without its
rows being carried anywhere. Jason's call: the app is unreleased, every row
in it is test data he can recreate, and there is no deployment to protect.

An earlier cut backfilled into a "Favorites" list and then chunked that at
200 to stay under `MAX_SPARKS_PER_LIST` — machinery that existed only to
preserve data nobody wanted, and which a review caught landing chunk one
exactly at the cap so it could never accept another spark. Deleting the
backfill deleted that bug and the oversized-key cast in the downgrade with
it. If this app ever ships and a later migration has to move real rows,
write the backfill then, against a cap that cannot bind.

The downgrade restores the TABLE, not its contents: an empty
`watched_sparks` and no `spark_lists`. Schema reversibility is what a
downgrade owes; there is nothing here whose loss anyone would notice.

Revision ID: c5e3a91f7d20
Revises: b8f2d1c40a7e
Create Date: 2026-08-04 00:00:00.000000

"""
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision = 'c5e3a91f7d20'
down_revision = 'b8f2d1c40a7e'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "spark_lists",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=40), nullable=False),
        sa.Column(
            "position", sa.Integer(), server_default=sa.text("0"), nullable=False
        ),
        sa.Column(
            "sparks",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["owner_id"], ["users.id"], name="fk_spark_lists_owner_id_users",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_spark_lists_owner_id", "spark_lists", ["owner_id"])
    # Case-insensitive per owner — see models.SparkList for why. An expression
    # index rather than a UniqueConstraint, because the comparison is folded
    # while the stored name keeps the case the user typed.
    op.execute(
        "CREATE UNIQUE INDEX uq_spark_list_owner_lower_name "
        "ON spark_lists (owner_id, lower(name))"
    )

    op.drop_index("ix_watched_sparks_owner_id", table_name="watched_sparks")
    op.drop_table("watched_sparks")


def downgrade() -> None:
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

    op.drop_index("ix_spark_lists_owner_id", table_name="spark_lists")
    op.drop_table("spark_lists")
