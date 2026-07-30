"""UmaLab API. Routes kept in one module for now; split into routers when it grows.

Schema is managed by Alembic — run `alembic upgrade head` before starting.
"""
from __future__ import annotations

import datetime as dt
import json
from typing import Literal

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from . import affinity, ingest, reference
from .database import get_session
from .models import Blueprint, Import, Veteran, VeteranTag

MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # ~100 veterans ≈ 1.7 MB; 25 MB is generous headroom

# Tags are a fixed set of favorite-mark icon ids, not free text (DECISIONS.md #9).
VALID_TAGS = frozenset(reference.TAG_ICONS)

# Built once — the relation reference is static for the process lifetime, and
# scoring against it is microseconds, so /api/affinity stays stateless
# (DECISIONS.md #17): no DB reads, no precomputed scores to go stale.
RELATION_TABLE = affinity.build_relation_table(
    reference.RELATION_POINTS, reference.RELATION_MEMBERS
)

app = FastAPI(title="UmaLab")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # vite dev server
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- schemas ----------

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
    trainee_chara_id: int
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
    chara_id/card_id; roster and lineage slots additionally reference the
    backing veteran by trained_chara_id (survives full-replace imports), with
    position_id saying which lineage member a `lineage` slot came from."""

    source: Literal["catalog", "roster", "lineage"]
    chara_id: int
    card_id: int
    trained_chara_id: int | None = None
    position_id: int | None = None

    @model_validator(mode="after")
    def _require_refs(self) -> BlueprintSlotIn:
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
    slots: BlueprintSlotsIn = BlueprintSlotsIn()

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


# ---------- imports ----------

@app.post("/api/imports", response_model=ImportOut, status_code=201)
async def create_import(
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
):
    """Full-replace snapshot import (DECISIONS.md #3): the uploaded dump becomes
    the entire roster, in one transaction.
    """
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "file too large — is this really an UmaExtractor dump?")
    try:
        data = json.loads(content)
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise HTTPException(400, f"not valid JSON: {e}") from e
    try:
        veterans = ingest.parse_dump(data, reference.CARDS, reference.FACTORS)
    except ingest.IngestError as e:
        raise HTTPException(400, str(e)) from e

    await session.execute(delete(Veteran))
    imp = Import(veteran_count=len(veterans), filename=file.filename or "data.json")
    session.add(imp)
    await session.flush()
    session.add_all(Veteran(import_id=imp.id, **fields) for fields in veterans)
    await session.commit()
    await session.refresh(imp)
    return imp


@app.get("/api/imports/latest", response_model=ImportOut | None)
async def latest_import(session: AsyncSession = Depends(get_session)):
    return await session.scalar(select(Import).order_by(Import.id.desc()).limit(1))


# ---------- veterans ----------

@app.get("/api/veterans", response_model=list[VeteranOut])
async def list_veterans(session: AsyncSession = Depends(get_session)):
    rows = await session.scalars(
        select(Veteran).order_by(Veteran.rank_score.desc(), Veteran.id)
    )
    tag_map: dict[int, list[str]] = {}
    tag_rows = await session.execute(
        select(VeteranTag.trained_chara_id, VeteranTag.tag).order_by(VeteranTag.tag)
    )
    for trained_chara_id, tag in tag_rows:
        tag_map.setdefault(trained_chara_id, []).append(tag)

    out: list[VeteranOut] = []
    for veteran in rows:
        item = VeteranOut.model_validate(veteran)
        item.tags = tag_map.get(veteran.trained_chara_id, [])
        out.append(item)
    return out


# ---------- tags ----------

@app.post("/api/veterans/{trained_chara_id}/tags", status_code=201)
async def add_tag(
    trained_chara_id: int,
    body: TagIn,
    session: AsyncSession = Depends(get_session),
):
    """Replace semantics: a veteran carries at most one mark, so assigning a
    new one displaces the old. Idempotent for repeats of the same mark.
    """
    tag = body.tag.strip()
    if tag not in VALID_TAGS:
        raise HTTPException(400, f"unknown tag id {tag!r} — tags are fixed mark ids")
    known = await session.scalar(
        select(Veteran.id).where(Veteran.trained_chara_id == trained_chara_id)
    )
    if known is None:
        raise HTTPException(404, "no veteran with that trained_chara_id in the roster")
    stmt = (
        pg_insert(VeteranTag)
        .values(trained_chara_id=trained_chara_id, tag=tag)
        .on_conflict_do_update(
            constraint="uq_veteran_tag_trained_chara_id", set_={"tag": tag}
        )
    )
    await session.execute(stmt)
    await session.commit()
    return {"trained_chara_id": trained_chara_id, "tag": tag}


@app.delete("/api/veterans/{trained_chara_id}/tags/{tag}", status_code=204)
async def remove_tag(
    trained_chara_id: int,
    tag: str,
    session: AsyncSession = Depends(get_session),
):
    """Clear the veteran's mark. Under the one-mark model the path's {tag} is
    advisory only — a stale client naming the old mark must still clear the
    current one, so we delete whatever the veteran carries.
    """
    del tag
    row = await session.scalar(
        select(VeteranTag).where(VeteranTag.trained_chara_id == trained_chara_id)
    )
    if row:
        await session.delete(row)
        await session.commit()


# ---------- catalog ----------

def _build_catalog() -> list[CatalogEntryOut]:
    cards_by_chara: dict[int, list[int]] = {}
    for card_id, card in reference.CARDS.items():
        cards_by_chara.setdefault(card["chara_id"], []).append(card_id)
    entries = [
        CatalogEntryOut(
            chara_id=chara_id,
            name=reference.CARDS[card_ids[0]]["name"],
            card_ids=card_ids,
        )
        for chara_id, card_ids in (
            (cid, sorted(ids)) for cid, ids in cards_by_chara.items()
        )
    ]
    entries.sort(key=lambda entry: (entry.name, entry.chara_id))
    return entries


# Static per process, like the reference data it derives from.
CATALOG = _build_catalog()


@app.get("/api/catalog", response_model=list[CatalogEntryOut])
async def get_catalog():
    """Every known character (deduped across outfits) for theoretical slot
    picks in the blueprint designer."""
    return CATALOG


# ---------- affinity ----------

@app.post("/api/affinity", response_model=AffinityOut)
async def score_affinity(body: AffinityIn):
    """Score a (possibly partial) blueprint. Stateless by design (DECISIONS.md
    #17): slots arrive with their won-saddle ids and are expanded server-side,
    so nothing here can go stale against the roster. Slot configurations the
    game would reject score 0 on the offending links rather than erroring —
    the designer enforces pickability, not this endpoint."""
    slots = {
        slot_id: slot.to_slot() if slot is not None else None
        for slot_id, slot in (
            ("p1", body.p1), ("p2", body.p2),
            ("g11", body.g11), ("g12", body.g12),
            ("g21", body.g21), ("g22", body.g22),
        )
    }
    result = affinity.score_blueprint(RELATION_TABLE, body.trainee_chara_id, **slots)
    symbol = affinity.symbol_for(result["total"], reference.AFFINITY_RANKS)
    return AffinityOut.model_validate({"symbol": symbol, **result})


# ---------- blueprints ----------

@app.get("/api/blueprints", response_model=list[BlueprintOut])
async def list_blueprints(session: AsyncSession = Depends(get_session)):
    return (
        await session.scalars(
            select(Blueprint).order_by(Blueprint.updated_at.desc(), Blueprint.id.desc())
        )
    ).all()


@app.post("/api/blueprints", response_model=BlueprintOut, status_code=201)
async def create_blueprint(
    body: BlueprintIn,
    session: AsyncSession = Depends(get_session),
):
    blueprint = Blueprint(
        name=body.name,
        trainee_chara_id=body.trainee_chara_id,
        slots=body.slots.model_dump(),
    )
    session.add(blueprint)
    await session.commit()
    await session.refresh(blueprint)
    return blueprint


@app.put("/api/blueprints/{blueprint_id}", response_model=BlueprintOut)
async def update_blueprint(
    blueprint_id: int,
    body: BlueprintIn,
    session: AsyncSession = Depends(get_session),
):
    """Full-document replace — the designer always saves its whole state."""
    blueprint = await session.get(Blueprint, blueprint_id)
    if blueprint is None:
        raise HTTPException(404, "no blueprint with that id")
    blueprint.name = body.name
    blueprint.trainee_chara_id = body.trainee_chara_id
    blueprint.slots = body.slots.model_dump()
    await session.commit()
    await session.refresh(blueprint)
    return blueprint


@app.delete("/api/blueprints/{blueprint_id}", status_code=204)
async def delete_blueprint(
    blueprint_id: int,
    session: AsyncSession = Depends(get_session),
):
    blueprint = await session.get(Blueprint, blueprint_id)
    if blueprint is None:
        raise HTTPException(404, "no blueprint with that id")
    await session.delete(blueprint)
    await session.commit()
