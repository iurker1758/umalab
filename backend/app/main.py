"""UmaLab API. Routes kept in one module for now; split into routers when it grows.

Schema is managed by Alembic — run `alembic upgrade head` before starting.
"""
from __future__ import annotations

import datetime as dt
import json

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from . import ingest, reference
from .database import get_session
from .models import Import, Veteran, VeteranTag

MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # ~100 veterans ≈ 1.7 MB; 25 MB is generous headroom

# Tags are a fixed set of favorite-mark icon ids, not free text (DECISIONS.md #9).
VALID_TAGS = frozenset(reference.TAG_ICONS)

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
    factors: list[FactorOut]
    skills: list[SkillOut]
    lineage: list[LineageMemberOut]
    # Filled from veteran_tags, not a Veteran column. Kept a list even though
    # a veteran carries at most one mark — widening back to multiple is then
    # an app-level change, not an API break.
    tags: list[str] = []
    model_config = {"from_attributes": True}


class ImportOut(BaseModel):
    id: int
    imported_at: dt.datetime
    veteran_count: int
    filename: str
    model_config = {"from_attributes": True}


class TagIn(BaseModel):
    tag: str = Field(min_length=1, max_length=40)


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
