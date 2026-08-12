"""Pydantic request/response models for the API, shared across routers."""
from __future__ import annotations

import datetime as dt
from typing import Annotated, Literal, get_args

from pydantic import (
    BaseModel,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

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


class PickableFactorOut(BaseModel):
    """One spark from the factor REFERENCE, for typing a member's into a
    designed node by hand — as opposed to `FactorOut` above, which is one
    decoded off a real veteran's dump. Roster and lineage slots get theirs
    that way; a catalog pick is a card, not a horse, so its sparks are
    hand-entered and need the real names to pick from.

    Pinks are absent: they have their own ten-aptitude editor, and the
    document keeps them in `spark` rather than here."""

    kind: SlotFactorKind
    key: int
    name: str


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
    # Per-slot individual affinity — every link that ancestor appears in (see
    # affinity.node_affinity). None while that slot is unset. The
    # inspiration-proc model rolls per ancestor, so it reads these rather than
    # the total. They do NOT sum to it: the p1-p2 link lands in both parents,
    # and a grandparent's triple is also inside its parent's number.
    p1_affinity: int | None
    p2_affinity: int | None
    g11_affinity: int | None
    g12_affinity: int | None
    g21_affinity: int | None
    g22_affinity: int | None


# The ten aptitude keys in the game's display order (track, distance,
# running style) — the same keys reference.CardAptitudes uses.
AptitudeKey = Literal[
    "turf", "dirt",
    "sprint", "mile", "medium", "long",
    "front", "pace", "late", "end",
]

# Aptitude grades, worst to best. Spelled out rather than left as `str`
# because the client parses a slot's stored letters strictly — anything it
# can't read makes that blueprint unopenable, and the server is the authority
# on what may be stored.
AptitudeLetter = Literal["G", "F", "E", "D", "C", "B", "A", "S"]

# Blueprint tree shape (DECISIONS.md #25): 31 nodes breadth-first (node i's
# kids are 2i+1 / 2i+2). Indices 0-6 — trainee, parents, grandparents —
# carry identity; 7-30 (generations 3-4) are anonymous pink-spark slots
# that exist only to feed the bracket math of the generations above.
NAMED_SLOT_COUNT = 7
SPARK_SLOT_COUNT = 24
NODE_SLOT_COUNT = NAMED_SLOT_COUNT + SPARK_SLOT_COUNT


class PinkSparkIn(BaseModel):
    """A generation-3/4 slot: a pink (aptitude) spark, a character, or both.

    Every lineage member carries exactly one pink — verified against a real
    159-veteran dump, all 954 lineage members included — so the spark is a
    single value, not a list.

    `card_id` names who the slot is. Decoration for the math — the brackets
    read aptitude and stars only — but it is what puts a portrait on a node
    too deep to carry a name.

    aptitude/stars are optional so a slot can hold a character with no pink
    yet, and are set TOGETHER: half a spark would silently read as a different
    one downstream. A slot with neither is written as null, not as an empty
    husk.

    Deliberately flat rather than nesting the spark under the identity: `slots`
    is JSONB and a row written before `card_id` existed is exactly this shape
    already, so it parses with no migration and no compatibility shim.
    """

    aptitude: AptitudeKey | None = None
    stars: int | None = Field(default=None, ge=1, le=3)
    card_id: int | None = None
    # Where the character came from when one was pulled rather than picked:
    # `roster` for the veteran a pull was aimed at, `lineage` for the members
    # it brought with her. Absent means hand-picked. This is what marks a
    # branch as recorded history — see the designer's lock rules.
    source: Literal["roster", "lineage"] | None = None

    @model_validator(mode="after")
    def _check_spark(self) -> PinkSparkIn:
        if (self.aptitude is None) != (self.stars is None):
            raise ValueError("aptitude and stars must be set together")
        if self.aptitude is None and self.card_id is None:
            raise ValueError("a slot must carry a spark, a character, or both")
        if self.source is not None and self.card_id is None:
            raise ValueError("a pulled slot needs a character")
        return self


# The inheritable spark kinds a designed node can carry, beside its pink
# (DECISIONS.md #40). Adding a kind is a line here and a line in the
# frontend's rate map — and a deliberate decision about ListSparkKind below,
# which does NOT follow this set.
SlotFactorKind = Literal["blue", "white", "unique", "race", "scenario"]


class SlotFactorIn(BaseModel):
    """One non-pink spark on a named slot, for the inspiration-proc estimates
    (DECISIONS.md #30). The pink keeps its own `spark` field — it is the one
    that also feeds the deterministic career-start brackets.

    Kind, key and stars only: `key` is the game's factor key (what
    `ingest.decode_factor` reads — skill_id // 10 for whites, the source
    card_id for uniques), and the display name is resolved from the committed
    factor reference at render time. Storing both would let a blueprint
    disagree with the reference after a regen.

    `kind` rides along rather than being derived from the key, because it
    decides the base rate (a 3★ white is 9% an event, a 3★ race 3%) and the key
    ranges that separate the kinds are an ingest heuristic, not a guarantee.

    Unknown keys are accepted deliberately. The reference is regenerated by
    hand, so it can legitimately run behind a dump that already carries a new
    skill — and `BlueprintOut` validates strictly enough that one unparseable
    row 500s the whole blueprint list. Rejecting keys here would turn a
    reference gap into a saved design nobody can open.
    """

    kind: SlotFactorKind
    key: int = Field(ge=1)
    stars: int = Field(ge=1, le=3)


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

    chara_id/card_id are nullable so a named node can carry sparks with no
    character chosen yet: planning usually starts from the sparks you're
    hunting rather than from a cast. Such a slot must carry SOMETHING — a pink,
    a non-pink spark, or both. An empty node is written as a null slot, not as
    an identity-less husk. A pink is not required beside `factors`: "whatever
    carries these two whites" is as real a plan, and requiring one would make
    clearing the pink destroy the spark list.

    Every rule in this model runs on READ too — BlueprintOut embeds
    BlueprintSlotsIn — so a rule here that a stored row can fail 500s the
    whole blueprint list. A rule that must bind on write only goes in
    BlueprintIn._validate instead (the green rule, DECISIONS.md #39)."""

    source: Literal["catalog", "roster", "lineage"]
    chara_id: int | None = None
    card_id: int | None = None
    win_saddle_ids: list[int] = []
    trained_chara_id: int | None = None
    position_id: int | None = None
    spark: PinkSparkIn | None = None
    # A roster pick's OWN aptitude letters, as trained. Snapshotted for the
    # same reason as win_saddle_ids: a veteran that leaves the roster must keep
    # the numbers she was scored on. Only roster slots carry these — a catalog
    # pick is a card, not a horse, and the dump gives a lineage member no
    # aptitudes at all. All ten keys or none, since the client reads the map as
    # a whole and refuses a partial one.
    aptitudes: dict[AptitudeKey, AptitudeLetter] | None = None
    # The member's other sparks — blue, white, unique (green), race, scenario.
    # Optional and defaulted, which is the one way this document is allowed to
    # grow (DECISIONS.md #28). Unlike `spark`, these feed only the proc
    # estimates: inherited or not, never projected onto career-start letters.
    factors: list[SlotFactorIn] = []

    @model_validator(mode="after")
    def _check_slot(self) -> BlueprintSlotIn:
        if (self.chara_id is None) != (self.card_id is None):
            raise ValueError("chara_id and card_id must be set together")
        if self.card_id is None:
            if self.spark is None and not self.factors:
                raise ValueError("a slot without a character must carry a spark")
            if self.source != "catalog":
                raise ValueError(f"a {self.source} slot needs a character")
        elif ingest.derive_chara_id(self.card_id) != self.chara_id:
            raise ValueError(
                f"card {self.card_id} does not belong to chara {self.chara_id}"
            )
        if self.source != "catalog" and self.trained_chara_id is None:
            raise ValueError(f"a {self.source} slot needs a trained_chara_id")
        if self.aptitudes is not None:
            if self.source != "roster":
                raise ValueError("only a roster slot carries its own aptitudes")
            missing = set(get_args(AptitudeKey)) - self.aptitudes.keys()
            if missing:
                raise ValueError(
                    f"aptitudes must cover all ten keys, missing {sorted(missing)}"
                )
        # PinkSparkIn doubles as the generation-3/4 slot model, where a bare
        # character with no pink is legal. Here it is only ever a spark: a
        # named node keeps its identity in its own fields.
        if self.spark is not None:
            if self.spark.aptitude is None:
                raise ValueError("a named slot's spark needs an aptitude")
            # ...and nothing else: a spark carrying an identity here would
            # assert a character the client drops on read — a silently lossy
            # round-trip.
            if self.spark.card_id is not None or self.spark.source is not None:
                raise ValueError("a named slot's spark carries no identity of its own")
        if self.source == "lineage" and self.position_id is None:
            raise ValueError("a lineage slot needs a position_id")
        # One entry per spark: the proc estimates combine a spark's carriers,
        # so a duplicate would roll the same spark against itself and inflate
        # the chance. Keyed by kind AND key — the kinds number their keys
        # independently.
        ids = [(f.kind, f.key) for f in self.factors]
        if len(set(ids)) != len(ids):
            raise ValueError("a slot can't carry the same spark twice")
        # One blue per member — a uma carries exactly one of the five stats.
        # Safe on READ, unlike the green rule (DECISIONS.md #39): this rule
        # lands in the same change that admits the kind, so no stored row can
        # predate it.
        if sum(1 for f in self.factors if f.kind == "blue") > 1:
            raise ValueError("a member carries one blue spark")
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
        # The game's breeding rules over the WHOLE tree, at every depth, so a
        # saved design is always one the parent-select screen would accept.
        # Both say the same thing — a horse is not its own ancestor, and a
        # pairing is between two different horses:
        #
        #   * no node may repeat the character of the node directly above it;
        #   * two nodes sharing a parent must be different characters.
        #
        # Partial designs are fine: a slot naming nobody collides with nothing.
        # A grandparent repeating the TRAINEE's chara is deliberately allowed —
        # the game permits it, and app/affinity.py scores it correctly.
        trainee = self.slots.named[0]
        if trainee is not None and (trainee.spark is not None or trainee.factors):
            # Nothing is bred FROM the trainee inside this design, so a spark
            # on her is a plan input with nothing to feed.
            raise ValueError("the trainee slot can't carry a spark")

        charas = [self._chara_at(i) for i in range(NODE_SLOT_COUNT)]
        for i in range(1, NODE_SLOT_COUNT):
            parent = (i - 1) // 2
            if charas[i] is not None and charas[i] == charas[parent]:
                raise ValueError(
                    "a parent can't be the trainee's own character"
                    if i <= 2
                    else "a grandparent can't repeat its own parent's character"
                    if i < NAMED_SLOT_COUNT
                    else "a slot can't repeat the character of the slot above it"
                )
        for parent in range(NODE_SLOT_COUNT // 2):
            a, b = 2 * parent + 1, 2 * parent + 2
            if charas[a] is not None and charas[a] == charas[b]:
                raise ValueError(
                    "the two parents must be different characters"
                    if parent == 0
                    else "a parent's two grandparents must be different"
                    if parent < 3
                    else "two slots sharing a parent must be different characters"
                )

        # A green's factor key IS the card_id (DECISIONS.md #36): a member can
        # learn another uma's unique during a run, but she can never carry the
        # SPARK for one — zero exceptions across 1,372 real roster rows. A slot
        # with no character stays legal: "whatever carries this green" is a
        # plan (#30), and there is nothing to check it against. Neither can a
        # 7-digit NPC-variant card (the same range derive_chara_id special-
        # cases): no unique factor key exists at those ids, so "her own" is
        # unsatisfiable there and rejecting would strand a pulled branch —
        # its sparks are locked client-side — in a document that can never
        # save again.
        #
        # Checked HERE and not in BlueprintSlotIn, because BlueprintOut embeds
        # BlueprintSlotsIn — the slot model must stay permissive so a row saved
        # before this rule can't 500 the whole blueprint list on read
        # (DECISIONS.md #39). This is not the unknown-key leniency of #30:
        # no reference lookup is involved, the key contradicts the slot itself.
        for slot in self.slots.named:
            if slot is None or slot.card_id is None or slot.card_id > 999_999:
                continue
            for factor in slot.factors:
                if factor.kind == "unique" and factor.key != slot.card_id:
                    raise ValueError(
                        f"green {factor.key} is not card {slot.card_id}'s own unique"
                    )
        return self

    def _chara_at(self, i: int) -> int | None:
        """The character at a tree index, or None where none is named.

        Named nodes carry chara_id outright; a generation-3/4 slot stores
        only a card, so its chara is derived the same way the ingest does it.
        """
        if i < NAMED_SLOT_COUNT:
            slot = self.slots.named[i]
            return None if slot is None else slot.chara_id
        deep = self.slots.sparks[i - NAMED_SLOT_COUNT]
        if deep is None or deep.card_id is None:
            return None
        return ingest.derive_chara_id(deep.card_id)


class BlueprintOut(BaseModel):
    id: int
    name: str
    slots: BlueprintSlotsIn
    created_at: dt.datetime
    updated_at: dt.datetime
    model_config = {"from_attributes": True}


# ---------- spark lists ----------

# A user-authored list name. Bounded so the column can't be used as free
# storage, and stripped rather than rejected for whitespace — a name typed
# with a trailing space is the same list.
SparkListName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)
]


# A list's membership is DELIBERATELY UNBOUNDED. A cap here can only bind on
# something you wanted to keep: the chooser adds sparks from the factor
# reference, so the reachable maximum IS the reference size, and that grows
# every time the game ships characters and skills. `_dedupe` collapses
# membership to distinct (kind, key) pairs, but nothing bounds the request body
# (`app/main.py` adds only CORS), so this is genuinely unbounded.
#
# Accepted rather than overlooked: the failure modes are not symmetric. A cap
# set too low is a permanent 422 on data the app itself produced, which the
# user cannot read or escape; no cap is a large row in the user's own account,
# behind Access, which they can delete. A real bound belongs at the transport,
# not as a constant here that ages against a growing reference.
#
# 50 LISTS is a different kind of number — named builds a person keeps, with no
# reference deciding a natural ceiling — so it bounds rows rather than limiting
# what legitimate use walks into.
MAX_LISTS_PER_OWNER = 50


# The kinds a list may hold: what a hunt can be FOR. Narrower than
# SlotFactorKind — blues and greens are excluded because every parent carries
# her blue and her own green regardless, so a list naming one selects nothing.
# Strict on read as well as write, which the loud-read rule below makes safe
# only because migration a7c4e2b91f55 deletes any entry outside this set at
# upgrade — the strict read can never meet a row that predates the rule.
# Widening this later is free; narrowing it again needs another migration.
ListSparkKind = Literal["white", "race", "scenario"]


class SparkRef(BaseModel):
    """One membership entry: the identity every spark surface uses.

    No `key` validation against the factor reference, matching SlotFactorIn —
    the reference is regenerated by hand and can run behind a dump, and a
    spark it doesn't know is still a legitimate thing to want.

    No `stars`: the list records WHICH sparks you care about, not what level
    you last typed. The level belongs to the slot document (DECISIONS.md #33,
    upheld by #37).
    """

    model_config = {"extra": "forbid"}

    kind: ListSparkKind
    # Bounded to int4 like `SlotFactorIn.key`, not because JSONB minds but
    # because an oversized key is unrepresentable everywhere else the app puts
    # a factor id — accepting one here stores something nothing downstream can
    # use.
    key: int = Field(ge=1, le=2_147_483_647)


class SparkListCreate(BaseModel):
    """A new list, with whatever sparks it should open holding.

    `sparks` exists for the picker's `New List`, reached while starring a
    spark — carrying the membership makes the create one request instead of
    a POST plus a member write that can fail separately (issue #69,
    DECISIONS.md #49). Empty stays a normal state, not a transient: the
    Lists page creates bare lists, and #33's derived group vocabulary could
    not represent one at all (DECISIONS.md #37).

    Create-only. Membership EDITS stay per-spark rows on the member routes;
    the whole-array PATCH remains forbidden (issue #66, DECISIONS.md #48).
    """

    model_config = {"extra": "forbid"}

    name: SparkListName
    sparks: list[SparkRef] = []

    @field_validator("sparks")
    @classmethod
    def _dedupe(cls, sparks: list[SparkRef]) -> list[SparkRef]:
        """Distinct (kind, key), first occurrence keeping its place — the
        same answer a repeated add gets from the member route's idempotent
        insert, so one request and two cannot disagree."""
        seen: dict[tuple[str, int], SparkRef] = {}
        for spark in sparks:
            seen.setdefault((spark.kind, spark.key), spark)
        return list(seen.values())


class SparkListPatch(BaseModel):
    """A change to one list; the id travels in the path.

    Rename-only: membership is rows in `spark_list_members`, written one at
    a time through its own routes, so no client ever sends a whole `sparks`
    array (issue #66, DECISIONS.md #48). A field that is absent or `null` is
    left alone — the rule #33's amendment arrived at.

    `extra="forbid"` because absence carries meaning: a mis-keyed body would
    otherwise parse as all-absent and answer 200 having written nothing, so
    a failed save would reach the user as a successful one. It is also what
    makes a stale client's `sparks` array a loud 422 rather than a silent
    no-op.
    """

    model_config = {"extra": "forbid"}

    name: SparkListName | None = None


class SparkListOut(BaseModel):
    """The read side. STRICT, and `sparks` is validated by the same `SparkRef`
    the request uses.

    Strictness is safe now for a different reason than it was dangerous
    before: membership rows have typed columns and a CHECK on `kind`
    mirroring `ListSparkKind` (models.SparkListMember), so an entry this
    model cannot parse is unrepresentable — the one-bad-entry-500s-every-
    list failure the JSONB column was filed under is retired, not tolerated
    (issue #66's absorbed #75, DECISIONS.md #48).

    `sparks` keeps the exact wire shape the array had — bare {kind, key} in
    member-id order — so every reader (the chooser, the filter surfaces, the
    e2e's payload comparisons) is untouched by the storage change. The
    routes build it from the member rows; nothing here maps a relationship.
    """

    id: int
    name: str
    # For the management page's "Last Edited" sort; `id` carries creation
    # order, so there is no created_at (DECISIONS.md #44).
    updated_at: dt.datetime
    sparks: list[SparkRef]
