"""Database schema.

Invariants (see DECISIONS.md #3, #5):

- Imports are full-replace snapshots: every upload deletes all veterans and
  inserts the new set in one transaction; `imports` rows are history metadata.
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


class Import(Base):
    __tablename__ = "imports"

    id: Mapped[int] = mapped_column(primary_key=True)
    imported_at: Mapped[datetime] = mapped_column(server_default=func.now())
    veteran_count: Mapped[int]
    filename: Mapped[str] = mapped_column(String(200))


class Veteran(Base):
    __tablename__ = "veterans"

    id: Mapped[int] = mapped_column(primary_key=True)
    import_id: Mapped[int] = mapped_column(ForeignKey("imports.id"))
    trained_chara_id: Mapped[int] = mapped_column(unique=True)
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
    __table_args__ = (
        UniqueConstraint("trained_chara_id", name="uq_veteran_tag_trained_chara_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    trained_chara_id: Mapped[int]
    tag: Mapped[str] = mapped_column(String(40))
