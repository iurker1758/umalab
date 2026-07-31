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


class BulkTagIn(BaseModel):
    """One mark assignment applied to many veterans (DECISIONS.md #20).
    `tag` is required: an explicit null means clear — the selection's marks
    are removed. No default, so a body that omits (or misspells) the key
    422s instead of silently selecting the destructive clear branch."""

    # 5000 is far beyond any roster the game can hold, even fully expanded —
    # the bound only exists to stop a runaway request body.
    trained_chara_ids: list[int] = Field(min_length=1, max_length=5000)
    tag: str | None = Field(min_length=1, max_length=40)


class CatalogCardOut(BaseModel):
    """One outfit of a catalog character. Aptitudes ride along because base
    letters are per-CARD (DECISIONS.md #23 — Haru Urara's New Year outfit
    runs Mile A against her base B); None when a card is missing from
    aptitudes.json (a regen gap — "letters unknown" in the UI)."""

    card_id: int
    outfit: str
    aptitudes: reference.CardAptitudes | None


class CatalogEntryOut(BaseModel):
    chara_id: int
    name: str
    cards: list[CatalogCardOut]  # sorted by card_id; [0] is the base outfit (icon source)


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
    # Optional: a saved trainee-less draft must be scorable when reopened.
    # Trainee links score 0 until one is chosen.
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


# The ten aptitude keys in the game's display order (track, distance,
# running style) — the same keys reference.CardAptitudes uses.
AptitudeKey = Literal[
    "turf", "dirt",
    "sprint", "mile", "medium", "long",
    "front", "pace", "late", "end",
]

# Blueprint tree shape (DECISIONS.md #25): 31 nodes breadth-first (node i's
# kids are 2i+1 / 2i+2). Indices 0-6 — trainee, parents, grandparents —
# carry identity; 7-30 (generations 3-4) are anonymous pink-spark slots
# that exist only to feed the bracket math of the generations above.
NAMED_SLOT_COUNT = 7
SPARK_SLOT_COUNT = 24


class PinkSparkIn(BaseModel):
    """One pink (aptitude) spark. Single, not a list: every lineage member
    carries exactly one pink — verified against a real 159-veteran dump
    (all 954 lineage members included).

    `card_id` is optional identity for the generation-3 slots, which a roster
    pull fills from the picked veteran's own grandparents (position_id
    11/12/21/22). Anonymous everywhere else, and anonymous forever at
    generation 4 — the game stores only two generations per veteran, so no
    real data exists below that. Purely decorative: the bracket math reads
    aptitude/stars only. `slots` is a JSONB column, so rows written before
    this field simply lack it and parse unchanged (no migration)."""

    aptitude: AptitudeKey
    stars: int = Field(ge=1, le=3)
    card_id: int | None = None


class BlueprintSlotIn(BaseModel):
    """One designed named slot (DECISIONS.md #16). Every slot snapshots
    chara_id/card_id AND the pick's won-saddle ids — the wins must ride in
    the snapshot so a slot whose veteran left the roster keeps its win bonus
    when re-scored, not just its portrait. Roster and lineage slots
    additionally reference the backing veteran by trained_chara_id (survives
    full-replace imports), with position_id saying which lineage member a
    `lineage` slot came from. `spark` is the member's typed-in pink —
    catalog picks have no dump to read it from, and the bracket math needs
    it (the trainee slot never carries one; nothing is bred from it).

    chara_id/card_id are nullable so a named node can carry a spark with no
    character chosen yet: the bracket math only needs the pinks below a node,
    and planning usually starts from the sparks you're hunting rather than
    from a cast. Such a slot must actually carry a spark — an empty node is
    written as a null slot, not as an identity-less husk."""

    source: Literal["catalog", "roster", "lineage"]
    chara_id: int | None = None
    card_id: int | None = None
    win_saddle_ids: list[int] = []
    trained_chara_id: int | None = None
    position_id: int | None = None
    spark: PinkSparkIn | None = None

    @model_validator(mode="after")
    def _check_slot(self) -> BlueprintSlotIn:
        if (self.chara_id is None) != (self.card_id is None):
            raise ValueError("chara_id and card_id must be set together")
        if self.card_id is None:
            if self.spark is None:
                raise ValueError("a slot without a character must carry a spark")
            if self.source != "catalog":
                raise ValueError(f"a {self.source} slot needs a character")
        elif ingest.derive_chara_id(self.card_id) != self.chara_id:
            raise ValueError(
                f"card {self.card_id} does not belong to chara {self.chara_id}"
            )
        if self.source != "catalog" and self.trained_chara_id is None:
            raise ValueError(f"a {self.source} slot needs a trained_chara_id")
        if self.source == "lineage" and self.position_id is None:
            raise ValueError("a lineage slot needs a position_id")
        return self


class BlueprintSlotsIn(BaseModel):
    """Blueprint document v2 (DECISIONS.md #25). `named` is the identity
    triangle breadth-first — [0] trainee, [1-2] parents, [3-6] grandparents;
    `sparks` covers tree indices 7-30 (generations 3-4) as bare pinks.
    Both required with exact lengths: the document is positional, so a
    short array would silently shift every slot below the gap."""

    named: list[BlueprintSlotIn | None] = Field(
        min_length=NAMED_SLOT_COUNT, max_length=NAMED_SLOT_COUNT
    )
    sparks: list[PinkSparkIn | None] = Field(
        min_length=SPARK_SLOT_COUNT, max_length=SPARK_SLOT_COUNT
    )


class BlueprintIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    # Required: PUT is full-document replace, so a body that forgot `slots`
    # must 422 rather than silently wipe a saved design.
    slots: BlueprintSlotsIn

    @model_validator(mode="after")
    def _validate(self) -> BlueprintIn:
        self.name = self.name.strip()
        if not self.name:
            raise ValueError("name must not be blank")
        # The game's breeding rules over the named triangle, so a saved
        # design is always one the parent-select screen would accept.
        # Partial designs are fine — rules apply only between filled slots.
        # A grandparent repeating the TRAINEE's chara is deliberately not
        # rejected: the game allows it (and app/affinity.py scores it
        # correctly). The anonymous spark slots carry no identity, so no
        # chara rule can apply below the grandparents.
        named = self.slots.named
        trainee = named[0]
        if trainee is not None and trainee.spark is not None:
            raise ValueError("the trainee slot can't carry a spark")
        # Identity-less (spark-only) slots sit out every chara rule — they
        # name no character to collide with.
        for i, kid in enumerate(named[1:], start=1):
            parent = named[(i - 1) // 2]
            if (
                kid is not None
                and parent is not None
                and kid.chara_id is not None
                and kid.chara_id == parent.chara_id
            ):
                raise ValueError(
                    "a parent can't be the trainee's own character"
                    if i <= 2
                    else "a grandparent can't repeat its own parent's character"
                )
        for i in range(NAMED_SLOT_COUNT // 2):
            a, b = named[2 * i + 1], named[2 * i + 2]
            if (
                a is not None
                and b is not None
                and a.chara_id is not None
                and a.chara_id == b.chara_id
            ):
                raise ValueError(
                    "the two parents must be different characters"
                    if i == 0
                    else "a parent's two grandparents must be different"
                )
        return self


class BlueprintOut(BaseModel):
    id: int
    name: str
    slots: BlueprintSlotsIn
    created_at: dt.datetime
    updated_at: dt.datetime
    model_config = {"from_attributes": True}
