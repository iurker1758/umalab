"""membership moves off the list row into spark_list_members

One row per (list, kind, key), replacing the `sparks` JSONB array (issue
#66, DECISIONS.md #48): membership edits become single-row inserts and
deletes with their own routes, so concurrent edits to one list commute
instead of last-write-wins over a whole array computed from a stale copy.
The CHECK on `kind` mirrors the schema's ListSparkKind — with typed columns
an entry the strict read model cannot parse is unrepresentable, which is
what retires the one-bad-entry-500s-every-list failure (#66's absorbed #75).

This is the backfill c5e3a91f7d20's docstring deferred until real rows had
to move. The ORDER BY makes the serial ids follow array position, so `id`
carries the display order the array's order used to carry. a7c4e2b91f55
already deleted every entry outside the kind set, so the CHECK cannot meet
a violating row.

The downgrade rebuilds the arrays in member-id order — the round trip is
lossless both ways.

Revision ID: f2b6d81c4a3e
Revises: e6a8d34f19c2
Create Date: 2026-08-12 00:00:00.000000

"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'f2b6d81c4a3e'
down_revision = 'e6a8d34f19c2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "spark_list_members",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("list_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("key", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["list_id"], ["spark_lists.id"],
            name="fk_spark_list_members_list_id_spark_lists",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("list_id", "kind", "key", name="uq_spark_list_member"),
        sa.CheckConstraint(
            "kind IN ('white', 'race', 'scenario')",
            name="ck_spark_list_member_kind",
        ),
    )
    op.create_index(
        "ix_spark_list_members_list_id", "spark_list_members", ["list_id"]
    )
    op.execute(
        """
        INSERT INTO spark_list_members (list_id, kind, key)
        SELECT l.id, e.value->>'kind', (e.value->>'key')::int
        FROM spark_lists AS l,
             jsonb_array_elements(l.sparks) WITH ORDINALITY AS e
        ORDER BY l.id, e.ordinality
        """
    )
    op.drop_column("spark_lists", "sparks")


def downgrade() -> None:
    op.add_column(
        "spark_lists",
        sa.Column(
            "sparks",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )
    op.execute(
        """
        UPDATE spark_lists AS l
        SET sparks = m.arr
        FROM (
            SELECT list_id,
                   jsonb_agg(jsonb_build_object('kind', kind, 'key', key)
                             ORDER BY id) AS arr
            FROM spark_list_members
            GROUP BY list_id
        ) AS m
        WHERE m.list_id = l.id
        """
    )
    op.drop_index(
        "ix_spark_list_members_list_id", table_name="spark_list_members"
    )
    op.drop_table("spark_list_members")
