"""spark lists replace watched sparks

The user's named lists of sparks they want (DECISIONS.md #37, issue #39),
replacing #33's single watched list with a `hunting` bit and a derived
group vocabulary. #37 holds why the axis was wrong.

BACKFILLED, not dropped cold. `groups` was never written by any UI, but the
star was, so real `watched_sparks` rows exist — each owner's become one list
named "Favorites" in `id` order, which is the order the chooser showed them.
Splitting that up afterwards is a rename and some picker clicks; losing it
is not recoverable. `hunting` is discarded, having never had a reader.

The downgrade restores the union of every list back into `watched_sparks`,
deduped on (owner, kind, key), all hunted and ungrouped. It cannot restore
which list a spark was in — that is what this migration is adding — nor the
insertion order, which the new shape has no column for. The round trip is
lossy in exactly the direction the redesign moved.

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

    # "Favorites" per owner who had watched sparks. Owners with none get no
    # list at all rather than an empty one — a list they never made, sitting
    # in the picker, is worse than the zero-list first run the picker already
    # has to handle.
    #
    # CHUNKED AT 200, because the old table had no per-owner row cap and the
    # new one does (schemas.MAX_SPARKS_PER_LIST). An owner with 250 stars
    # would otherwise land in one 250-entry list that no membership write can
    # ever save: every edit sends the whole array back, which 422s on the cap,
    # so the only operation left would be deleting the lot. Chunking keeps
    # every spark AND leaves each list editable. The literal is duplicated
    # here on purpose — a migration is a historical snapshot and must not
    # import app code that will move under it.
    op.execute(
        """
        INSERT INTO spark_lists (owner_id, name, position, sparks)
        SELECT owner_id,
               CASE WHEN chunk = 0 THEN 'Favorites'
                    ELSE 'Favorites ' || (chunk + 1)::text END,
               chunk,
               jsonb_agg(
                   jsonb_build_object('kind', kind, 'key', key) ORDER BY id
               )
        FROM (
            SELECT owner_id, kind, key, id,
                   (row_number() OVER (PARTITION BY owner_id ORDER BY id) - 1)
                       / 200 AS chunk
            FROM watched_sparks
        ) numbered
        GROUP BY owner_id, chunk
        """
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

    # The union of every list, deduped — the old table's unique constraint is
    # per (owner, kind, key), and a spark in two builds was one row there.
    #
    # The recreated `id` sequence follows (owner, kind, key), NOT the order
    # the user had. Insertion order was the old table's only notion of order
    # and nothing in the new shape records it, so there is nothing to restore
    # it from; sorting by anything else here would only look like it did.
    op.execute(
        """
        INSERT INTO watched_sparks (owner_id, kind, key, hunting, groups)
        SELECT DISTINCT
               sl.owner_id,
               entry.value ->> 'kind' AS kind,
               (entry.value ->> 'key')::int AS key,
               true,
               '[]'::jsonb
        FROM spark_lists sl,
             jsonb_array_elements(sl.sparks) AS entry
        ORDER BY 1, 2, 3
        """
    )

    op.drop_index("ix_spark_lists_owner_id", table_name="spark_lists")
    op.drop_table("spark_lists")
