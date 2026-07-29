"""UmaLab API. Routes kept in one module for now; split into routers when it grows.

Schema is managed by Alembic — run `alembic upgrade head` before starting.
"""
from __future__ import annotations

import datetime as dt
import json

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from . import ingest, reference
from .database import get_session
from .models import Import, Veteran

MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # ~100 veterans ≈ 1.7 MB; 25 MB is generous headroom

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
    model_config = {"from_attributes": True}


class ImportOut(BaseModel):
    id: int
    imported_at: dt.datetime
    veteran_count: int
    filename: str
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
    return list(rows)
