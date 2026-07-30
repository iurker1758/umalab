"""Pydantic request/response models for the API, shared across routers."""
from __future__ import annotations

import datetime as dt
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from . import affinity, ingest, reference


class FactorOut(BaseModel):
    factor_id: int
    kind: str
    key: int
    star: int
    name: str


class LineageMemberOut(BaseModel):
    position_id: int
    relation: str
    card_id: int
    chara_id: int
    name: str
    outfit: str
    rarity: int
    talent_level: int
    rank: int
    factors: list[FactorOut]
    # Default covers lineage stored by pre-win-capture imports.
    win_saddles: list[int] = []


class SkillOut(BaseModel):
    skill_id: int
    level: int
    # Presentation-only enrichment from the bundled skills reference — the DB
    # keeps skills raw (DECISIONS.md #5, #12), so refreshed reference data
    # shows up without a re-import. None/defaults when the id is unknown.
    name: str | None = None
    rarity: int | None = None
    unique: bool = False

    @model_validator(mode="after")
    def _enrich(self) -> SkillOut:
        info = reference.SKILLS.get(self.skill_id)
        if info is not None:
            self.name = info["name"]
            self.rarity = info["rarity"]
            self.unique = info["unique"]
        return self


class VeteranOut(BaseModel):
    id: int
    trained_chara_id: int
    card_id: int
    chara_id: int
    name: str
    outfit: str
    rarity: int
    talent_level: int
    rank: int
    rank_score: int
    fans: int
    wins: int
    speed: int
    stamina: int
    power: int
    guts: int
    wiz: int
    proper_distance_short: int
    proper_distance_mile: int
    proper_distance_middle: int
    proper_distance_long: int
    proper_ground_turf: int
    proper_ground_dirt: int
    proper_running_style_nige: int
    proper_running_style_senko: int
    proper_running_style_sashi: int
    proper_running_style_oikomi: int
    register_time: str
    win_saddles: list[int] = []
    factors: list[FactorOut]
    skills: list[SkillOut]
    lineage: list[LineageMemberOut]
    # Filled from veteran_tags, not a Veteran column. Kept a list even though
    # a veteran carries at most one mark — widening back to multiple is then
    # an app-level change, not an API break.
    tags: list[str] = []
    # Card epithet ("[Special Dreamer]"), read-time enrichment like skill
    # names (DECISIONS.md #12) — not stored, so a cards.json refresh applies
    # without a re-import. Empty when the card is unknown to the reference.
    title: str = ""
    model_config = {"from_attributes": True}

    @model_validator(mode="after")
    def _enrich(self) -> VeteranOut:
        # The whole card identity refreshes together — updating only part of
        # it would pair a new epithet with a stale name after a rename.
        card = reference.CARDS.get(self.card_id)
        if card is not None:
            self.name = card["name"]
            self.outfit = card["outfit"]
            self.title = card["title"]
        return self


class ImportOut(BaseModel):
    id: int
    imported_at: dt.datetime
    veteran_count: int
    filename: str
    model_config = {"from_attributes": True}


class TagIn(BaseModel):
    tag: str = Field(min_length=1, max_length=40)


class CatalogEntryOut(BaseModel):
    chara_id: int
    name: str
    card_ids: list[int]  # sorted; [0] is the base outfit (icon source)


class AffinitySlotIn(BaseModel):
    """A filled blueprint slot: the chara plus its raw won-saddle ids (empty
    for catalog/theoretical picks — the client already holds real veterans'
    win_saddles from GET /api/veterans)."""

    chara_id: int
    win_saddle_ids: list[int] = []

    def to_slot(self) -> affinity.Slot:
        return affinity.Slot(
            chara_id=self.chara_id,
            wins=affinity.g1_wins(self.win_saddle_ids, reference.SADDLES),
        )


class AffinityIn(BaseModel):
    # Optional to mirror BlueprintIn: a saved trainee-less draft must be
    # scorable when reopened. Trainee links score 0 until one is chosen.
    trainee_chara_id: int | None = None
    p1: AffinitySlotIn | None = None
    p2: AffinitySlotIn | None = None
    g11: AffinitySlotIn | None = None
    g12: AffinitySlotIn | None = None
    g21: AffinitySlotIn | None = None
    g22: AffinitySlotIn | None = None


class AffinityLinkOut(BaseModel):
    link: str
    relation_points: int
    win_points: int


class AffinityOut(BaseModel):
    total: int
    symbol: str
    relation_total: int
    win_total: int
    links: list[AffinityLinkOut]
    p1_affinity: int | None
    p2_affinity: int | None


class BlueprintSlotIn(BaseModel):
    """One designed lineage slot (DECISIONS.md #16). Every slot snapshots
    chara_id/card_id AND the pick's won-saddle ids — the wins must ride in
    the snapshot so a slot whose veteran left the roster keeps its win bonus
    when re-scored, not just its portrait. Roster and lineage slots
    additionally reference the backing veteran by trained_chara_id (survives
    full-replace imports), with position_id saying which lineage member a
    `lineage` slot came from."""

    source: Literal["catalog", "roster", "lineage"]
    chara_id: int
    card_id: int
    win_saddle_ids: list[int] = []
    trained_chara_id: int | None = None
    position_id: int | None = None

    @model_validator(mode="after")
    def _check_slot(self) -> BlueprintSlotIn:
        if ingest.derive_chara_id(self.card_id) != self.chara_id:
            raise ValueError(
                f"card {self.card_id} does not belong to chara {self.chara_id}"
            )
        if self.source != "catalog" and self.trained_chara_id is None:
            raise ValueError(f"a {self.source} slot needs a trained_chara_id")
        if self.source == "lineage" and self.position_id is None:
            raise ValueError("a lineage slot needs a position_id")
        return self


class BlueprintSlotsIn(BaseModel):
    p1: BlueprintSlotIn | None = None
    p2: BlueprintSlotIn | None = None
    g11: BlueprintSlotIn | None = None
    g12: BlueprintSlotIn | None = None
    g21: BlueprintSlotIn | None = None
    g22: BlueprintSlotIn | None = None


class BlueprintIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    trainee_chara_id: int | None = None
    # Required: PUT is full-document replace, so a body that forgot `slots`
    # must 422 rather than silently wipe a saved design.
    slots: BlueprintSlotsIn

    @model_validator(mode="after")
    def _validate(self) -> BlueprintIn:
        self.name = self.name.strip()
        if not self.name:
            raise ValueError("name must not be blank")
        # The game's slot rules, so a saved design is always one the parent-
        # select screen would accept. Partial designs are fine — rules apply
        # only between filled slots. A grandparent repeating the TRAINEE's
        # chara is deliberately not rejected: the game allows it (and
        # app/affinity.py scores it correctly).
        s = self.slots
        for parent in (s.p1, s.p2):
            if (
                parent is not None
                and self.trainee_chara_id is not None
                and parent.chara_id == self.trainee_chara_id
            ):
                raise ValueError("a parent can't be the trainee's own character")
        if s.p1 is not None and s.p2 is not None and s.p1.chara_id == s.p2.chara_id:
            raise ValueError("the two parents must be different characters")
        for parent, gps in ((s.p1, (s.g11, s.g12)), (s.p2, (s.g21, s.g22))):
            for gp in gps:
                if parent is not None and gp is not None and gp.chara_id == parent.chara_id:
                    raise ValueError(
                        "a grandparent can't repeat its own parent's character"
                    )
        for a, b in ((s.g11, s.g12), (s.g21, s.g22)):
            if a is not None and b is not None and a.chara_id == b.chara_id:
                raise ValueError("a parent's two grandparents must be different")
        return self


class BlueprintOut(BaseModel):
    id: int
    name: str
    trainee_chara_id: int | None
    slots: BlueprintSlotsIn
    created_at: dt.datetime
    updated_at: dt.datetime
    model_config = {"from_attributes": True}
