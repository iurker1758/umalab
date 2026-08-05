"""spark lists hold listable kinds only

`SparkRef.kind` narrowed to white/race/scenario (DECISIONS.md #40): a list
is a hunt, and neither blues nor greens are hunted. The model is strict on
READ as well as write, and one unreadable entry fails the whole list read
on purpose — so a stored green or blue would take `GET /api/spark-lists`
down for its owner with no in-app way to remove it (management is #70).

A survey found zero such rows, but a survey is one database at one instant;
this delete is the same fact enforced at upgrade time, so the strict read
can never meet an entry that predates the rule. A no-op everywhere the
survey was true. The chooser only ever offered greens (never blues), so
in practice this is about greens starred before #85.

The downgrade is a no-op: the wider kind set was never data the schema
owed anyone back, and the deleted entries — if any existed — named sparks
that select nothing.

Revision ID: a7c4e2b91f55
Revises: c5e3a91f7d20
Create Date: 2026-08-05 00:00:00.000000

"""
from alembic import op

# revision identifiers, used by Alembic.
revision = 'a7c4e2b91f55'
down_revision = 'c5e3a91f7d20'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE spark_lists
        SET sparks = COALESCE(
            (
                SELECT jsonb_agg(entry)
                FROM jsonb_array_elements(sparks) AS entry
                WHERE entry->>'kind' IN ('white', 'race', 'scenario')
            ),
            '[]'::jsonb
        )
        WHERE EXISTS (
            SELECT 1
            FROM jsonb_array_elements(sparks) AS entry
            WHERE entry->>'kind' NOT IN ('white', 'race', 'scenario')
        )
        """
    )


def downgrade() -> None:
    pass
