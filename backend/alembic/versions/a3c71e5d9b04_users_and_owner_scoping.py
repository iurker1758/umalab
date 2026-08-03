"""users table and owner scoping

Multi-user (DECISIONS.md #32). Creates `users`, adds a non-nullable
`owner_id` to the four owned tables, and widens the two uniqueness rules
that were global to be per-owner.

The existing rows are one person's — the app has only ever had one user —
so they are backfilled onto a single owner rather than dropped. That owner
is DEV_USER_EMAIL (default dev@localhost), which is also who the app runs
as until an Access audience is configured, so a local database keeps
working with no further step. Deployments where the Access email differs
should set DEV_USER_EMAIL to that address BEFORE running this, or update
the row afterwards: the data is attached to whatever address this creates.

Adding owner_id nullable → backfill → SET NOT NULL, so the column is never
briefly non-nullable against rows that have no value for it.

Revision ID: a3c71e5d9b04
Revises: 0d9cf4e216a4
Create Date: 2026-08-03 00:00:00.000000

"""
import os

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = 'a3c71e5d9b04'
down_revision = '0d9cf4e216a4'
branch_labels = None
depends_on = None

OWNED_TABLES = ("imports", "veterans", "blueprints", "veteran_tags")


def _initial_owner_email() -> str:
    """Read straight from the environment rather than importing app.config.

    A migration that imports the settings object inherits every future
    setting's validation, and a required-but-unset one would then fail the
    upgrade for a reason that has nothing to do with the schema.
    """
    return (os.environ.get("DEV_USER_EMAIL") or "dev@localhost").strip().lower()


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )

    # The one owner every existing row is assigned to. Inserted through a
    # bound parameter, not an f-string: the address comes from the
    # environment.
    connection = op.get_bind()
    owner_id = connection.execute(
        sa.text("INSERT INTO users (email) VALUES (:email) RETURNING id"),
        {"email": _initial_owner_email()},
    ).scalar_one()

    for table in OWNED_TABLES:
        op.add_column(table, sa.Column("owner_id", sa.Integer(), nullable=True))
        connection.execute(
            sa.text(f"UPDATE {table} SET owner_id = :owner_id"), {"owner_id": owner_id}
        )
        op.alter_column(table, "owner_id", nullable=False)
        op.create_index(f"ix_{table}_owner_id", table, ["owner_id"])
        op.create_foreign_key(
            f"fk_{table}_owner_id_users",
            table,
            "users",
            ["owner_id"],
            ["id"],
            ondelete="CASCADE",
        )

    # Both uniqueness rules were global and become per-owner: two players'
    # dumps can carry the same trained_chara_id, and under the old rules the
    # second importer's upload would collide with the first's rows.
    op.drop_constraint("veterans_trained_chara_id_key", "veterans", type_="unique")
    op.create_unique_constraint(
        "uq_veteran_owner_chara", "veterans", ["owner_id", "trained_chara_id"]
    )
    # Same constraint NAME, wider columns — the tag upserts reference it by
    # name in their ON CONFLICT clause.
    op.drop_constraint(
        "uq_veteran_tag_trained_chara_id", "veteran_tags", type_="unique"
    )
    op.create_unique_constraint(
        "uq_veteran_tag_trained_chara_id",
        "veteran_tags",
        ["owner_id", "trained_chara_id"],
    )


def downgrade() -> None:
    """Reverses the schema. Rows belonging to a second user are NOT removed
    first, so both restored global constraints can fail on real multi-user
    data — which is the honest outcome: there is nowhere for the second
    user's veterans to go under a schema that cannot express them.
    """
    op.drop_constraint(
        "uq_veteran_tag_trained_chara_id", "veteran_tags", type_="unique"
    )
    op.create_unique_constraint(
        "uq_veteran_tag_trained_chara_id", "veteran_tags", ["trained_chara_id"]
    )
    op.drop_constraint("uq_veteran_owner_chara", "veterans", type_="unique")
    op.create_unique_constraint(
        "veterans_trained_chara_id_key", "veterans", ["trained_chara_id"]
    )

    for table in OWNED_TABLES:
        op.drop_constraint(f"fk_{table}_owner_id_users", table, type_="foreignkey")
        op.drop_index(f"ix_{table}_owner_id", table_name=table)
        op.drop_column(table, "owner_id")

    op.drop_table("users")
