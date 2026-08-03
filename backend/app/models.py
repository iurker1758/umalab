"""Database schema.

Invariants (see DECISIONS.md #3, #5, #32):

- Every row belongs to a user. `owner_id` is non-nullable on all four owned
  tables, and every query filters on it — the identity comes from a verified
  Cloudflare Access JWT (app/auth.py), never from anything the client sends.
- Imports are full-replace snapshots OF ONE USER'S ROSTER: every upload
  deletes that owner's veterans and inserts the new set in one transaction;
  `imports` rows are history metadata.
- Hybrid shape: scalar columns for anything the roster table sorts/filters
  on; JSONB for the tree-shaped decoded factors, raw skills, and lineage.
- `register_time` is stored as the game's raw string ("YYYY-MM-DD HH:MM:SS",
  unknown timezone) — it sorts lexicographically and is display-only.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import ForeignKey, String, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


class User(Base):
    """One row per person Cloudflare Access lets in (DECISIONS.md #32).

    Keyed by the email in the verified JWT claims — the Access policy is the
    invite list, so a row is created the first time someone who already got
    past Access shows up. That is not open signup: the gate is at the edge.
    No password, no session, no profile; this table exists to give the other
    four something to point at.

    320 = the maximum length of an email address (64 local + @ + 255 domain).
    """

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


# Every owned table takes the same column. Declared once so a fifth table
# can't quietly get a nullable one: a null owner is a row no query returns
# and no user can delete.
def _owner_column() -> Mapped[int]:
    return mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)


class Import(Base):
    __tablename__ = "imports"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = _owner_column()
    imported_at: Mapped[datetime] = mapped_column(server_default=func.now())
    veteran_count: Mapped[int]
    filename: Mapped[str] = mapped_column(String(200))


class Veteran(Base):
    __tablename__ = "veterans"
    # Unique PER OWNER, not globally: trained_chara_id is the game's id for a
    # horse in one player's save, so two players' dumps can collide on it. A
    # global constraint would make the second importer's upload fail on
    # someone else's row (DECISIONS.md #32).
    __table_args__ = (
        UniqueConstraint("owner_id", "trained_chara_id", name="uq_veteran_owner_chara"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = _owner_column()
    import_id: Mapped[int] = mapped_column(ForeignKey("imports.id"))
    trained_chara_id: Mapped[int]
    card_id: Mapped[int]
    chara_id: Mapped[int]  # derived card_id // 100 (the dump's own field is null)
    name: Mapped[str] = mapped_column(String(100))
    outfit: Mapped[str] = mapped_column(String(100))
    rarity: Mapped[int]
    talent_level: Mapped[int]
    rank: Mapped[int]
    rank_score: Mapped[int]
    fans: Mapped[int]
    wins: Mapped[int]
    speed: Mapped[int]
    stamina: Mapped[int]
    power: Mapped[int]
    guts: Mapped[int]
    wiz: Mapped[int]
    proper_distance_short: Mapped[int]
    proper_distance_mile: Mapped[int]
    proper_distance_middle: Mapped[int]
    proper_distance_long: Mapped[int]
    proper_ground_turf: Mapped[int]
    proper_ground_dirt: Mapped[int]
    proper_running_style_nige: Mapped[int]
    proper_running_style_senko: Mapped[int]
    proper_running_style_sashi: Mapped[int]
    proper_running_style_oikomi: Mapped[int]
    register_time: Mapped[str] = mapped_column(String(19))
    # Raw won-saddle ids (the dump's win_saddle_id_array) — expanded to G1
    # race sets at scoring time by app/affinity.py, never stored decoded.
    # The server_default keeps rows from pre-win-capture imports valid.
    win_saddles: Mapped[list[int]] = mapped_column(
        JSONB, server_default=text("'[]'::jsonb")
    )
    factors: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    skills: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    lineage: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)


class Blueprint(Base):
    """A saved inheritance design (DECISIONS.md #16, document v2 in #25).
    `slots` is the 31-node breadth-first tree: `named` holds the identity
    triangle ([0] trainee, [1-2] parents, [3-6] grandparents; null when
    unfilled), `sparks` the 24 anonymous pink-spark slots of generations
    3-4. Roster slots reference veterans by trained_chara_id — stable
    across full-replace imports, same reasoning as veteran_tags (#9) — and
    every named slot snapshots chara_id/card_id plus its won-saddle ids, so
    a slot whose veteran left the roster still displays AND keeps its win
    bonus when re-scored, degraded to a catalog-theoretical pick. Slots are
    never pruned to match the current roster.
    """
    __tablename__ = "blueprints"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = _owner_column()
    name: Mapped[str] = mapped_column(String(80))
    slots: Mapped[dict[str, Any]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now()
    )


class VeteranTag(Base):
    """A user-assigned mark tag (the game's own assignments aren't in the
    extractor dump). Keyed by trained_chara_id — NOT veterans.id — so tags
    survive full-replace imports (DECISIONS.md #9). Rows whose veteran is
    gone from the current snapshot are simply never displayed. At most one
    mark per veteran, matching the game's single favorite mark.
    """
    __tablename__ = "veteran_tags"
    # Keeps its name across the widening (DECISIONS.md #32) — the tag upserts
    # name this constraint in their ON CONFLICT clause, and a rename there is
    # a runtime error rather than a type error.
    __table_args__ = (
        UniqueConstraint(
            "owner_id", "trained_chara_id", name="uq_veteran_tag_trained_chara_id"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = _owner_column()
    trained_chara_id: Mapped[int]
    tag: Mapped[str] = mapped_column(String(40))


class WatchedSpark(Base):
    """A spark this user cares about (DECISIONS.md #33, issue #39).

    One list serving three features. `hunting` separates "keep this handy to
    type" from "I want this outcome"; `groups` holds the user's own build
    names ("Front Runner", "Medium"), so a spark that belongs to two builds
    is one row in two groups rather than a duplicate in two lists. Both are
    a bit and a label on the row, deliberately not a second table.

    Keyed by (kind, key), never a name: names are localized strings resolved
    at render time (DECISIONS.md #30). Unknown keys are accepted for the same
    reason blueprint factors accept them — `app/data` is regenerated by hand
    and can run behind a dump, and a spark missing from the reference is
    still a legitimate thing to want. There is no reconcile pass anywhere.

    Insertion order is `id` order, which is the order the chooser shows.
    """

    __tablename__ = "watched_sparks"
    __table_args__ = (
        UniqueConstraint("owner_id", "kind", "key", name="uq_watched_spark_owner_kind_key"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = _owner_column()
    # The Literal lives in schemas.py; the column is a plain short string so a
    # new kind is a schema line rather than a Postgres enum migration.
    kind: Mapped[str] = mapped_column(String(16))
    key: Mapped[int]
    hunting: Mapped[bool] = mapped_column(server_default=text("true"))
    groups: Mapped[list[str]] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
