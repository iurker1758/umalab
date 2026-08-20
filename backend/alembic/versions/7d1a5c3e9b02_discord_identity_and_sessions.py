"""Discord identity and server-side sessions (DECISIONS.md #58)

The login moves from Cloudflare Access to Discord OAuth, so `users` gains
the Discord snowflake it is keyed on from here and a display name, and
`email` turns nullable — a Discord account need not expose one. Existing
rows keep their email untouched: a first Discord login adopts the row whose
email matches the account's verified address, which is how an Access-era
roster follows its owner across the switch.

`sessions` holds the browser logins; the cookie token is stored hashed.

The downgrade drops the session table and the two columns and makes email
NOT NULL again, which fails if a Discord-only user (no email) exists — by
design: that row has no Access-era identity to go back to.

Revision ID: 7d1a5c3e9b02
Revises: f2b6d81c4a3e
Create Date: 2026-08-20 00:00:00.000000

"""
import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = '7d1a5c3e9b02'
down_revision = 'f2b6d81c4a3e'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("discord_id", sa.String(length=20), nullable=True))
    op.add_column(
        "users",
        sa.Column("name", sa.String(length=100), server_default="", nullable=False),
    )
    op.alter_column("users", "email", existing_type=sa.String(length=320), nullable=True)
    op.create_unique_constraint("uq_users_discord_id", "users", ["discord_id"])
    op.create_table(
        "sessions",
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("token_hash"),
    )
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_sessions_user_id", table_name="sessions")
    op.drop_table("sessions")
    op.drop_constraint("uq_users_discord_id", "users", type_="unique")
    op.alter_column("users", "email", existing_type=sa.String(length=320), nullable=False)
    op.drop_column("users", "name")
    op.drop_column("users", "discord_id")
