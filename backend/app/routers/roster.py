"""Roster routes: dump imports, the veteran list, and favorite-mark tags."""
from __future__ import annotations

import json
from typing import Any, cast

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import CursorResult, delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from .. import ingest, reference
from ..auth import current_user
from ..database import get_session
from ..models import Import, User, Veteran, VeteranTag
from ..schemas import BulkTagIn, ImportOut, TagIn, VeteranOut

router = APIRouter(prefix="/api")

MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # ~100 veterans ≈ 1.7 MB; 25 MB is generous headroom

# Tags are a fixed set of favorite-mark icon ids, not free text (DECISIONS.md #9).
VALID_TAGS = frozenset(reference.TAG_ICONS)


# ---------- imports ----------

@router.post("/imports", response_model=ImportOut, status_code=201)
async def create_import(
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    """Full-replace snapshot import (DECISIONS.md #3): the uploaded dump becomes
    THIS USER'S entire roster, in one transaction. The owner filter on the
    delete is what keeps that from meaning everyone's (DECISIONS.md #32).
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

    await session.execute(delete(Veteran).where(Veteran.owner_id == user.id))
    imp = Import(
        owner_id=user.id,
        veteran_count=len(veterans),
        filename=file.filename or "data.json",
    )
    session.add(imp)
    await session.flush()
    session.add_all(
        Veteran(owner_id=user.id, import_id=imp.id, **fields) for fields in veterans
    )
    await session.commit()
    await session.refresh(imp)
    return imp


@router.get("/imports/latest", response_model=ImportOut | None)
async def latest_import(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    return await session.scalar(
        select(Import)
        .where(Import.owner_id == user.id)
        .order_by(Import.id.desc())
        .limit(1)
    )


# ---------- veterans ----------

@router.get("/veterans", response_model=list[VeteranOut])
async def list_veterans(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    rows = await session.scalars(
        select(Veteran)
        .where(Veteran.owner_id == user.id)
        .order_by(Veteran.rank_score.desc(), Veteran.id)
    )
    tag_map: dict[int, list[str]] = {}
    tag_rows = await session.execute(
        select(VeteranTag.trained_chara_id, VeteranTag.tag)
        .where(VeteranTag.owner_id == user.id)
        .order_by(VeteranTag.tag)
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

@router.post("/veterans/tags/bulk")
async def bulk_tag(
    body: BulkTagIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    """Assign one mark to (or clear the marks of) many veterans in a single
    transaction (DECISIONS.md #20). All-or-nothing: any id missing from the
    roster fails the whole request, so a client selecting against a stale
    snapshot can't half-apply — it refreshes and retries instead.
    """
    tag = body.tag.strip() if body.tag is not None else None
    if tag is not None and tag not in VALID_TAGS:
        raise HTTPException(400, f"unknown tag id {tag!r} — tags are fixed mark ids")
    ids = set(body.trained_chara_ids)
    known = set(
        await session.scalars(
            select(Veteran.trained_chara_id).where(
                Veteran.owner_id == user.id, Veteran.trained_chara_id.in_(ids)
            )
        )
    )
    # Someone else's veteran is "no longer in the roster" from here, which is
    # the same 404 a stale client gets — the response can't distinguish them
    # without confirming the id exists on another account.
    missing = len(ids - known)
    if missing:
        raise HTTPException(
            404,
            f"{missing} selected veteran(s) are no longer in the roster — "
            "refresh and try again",
        )
    if tag is None:
        result = await session.execute(
            delete(VeteranTag).where(
                VeteranTag.owner_id == user.id, VeteranTag.trained_chara_id.in_(ids)
            )
        )
    else:
        stmt = pg_insert(VeteranTag).values(
            [{"owner_id": user.id, "trained_chara_id": i, "tag": tag} for i in sorted(ids)]
        )
        stmt = stmt.on_conflict_do_update(
            constraint="uq_veteran_tag_trained_chara_id",
            set_={"tag": stmt.excluded.tag},
        )
        result = await session.execute(stmt)
    await session.commit()
    # Rows actually touched, not len(ids): clearing an unmarked selection
    # honestly reports 0. DML executes return CursorResult at runtime; the
    # session.execute() stubs only promise Result, hence the cast.
    return {"updated": cast("CursorResult[Any]", result).rowcount, "tag": tag}


@router.post("/veterans/{trained_chara_id}/tags", status_code=201)
async def add_tag(
    trained_chara_id: int,
    body: TagIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    """Replace semantics: a veteran carries at most one mark, so assigning a
    new one displaces the old. Idempotent for repeats of the same mark.
    """
    tag = body.tag.strip()
    if tag not in VALID_TAGS:
        raise HTTPException(400, f"unknown tag id {tag!r} — tags are fixed mark ids")
    known = await session.scalar(
        select(Veteran.id).where(
            Veteran.owner_id == user.id, Veteran.trained_chara_id == trained_chara_id
        )
    )
    if known is None:
        raise HTTPException(404, "no veteran with that trained_chara_id in the roster")
    stmt = (
        pg_insert(VeteranTag)
        .values(owner_id=user.id, trained_chara_id=trained_chara_id, tag=tag)
        .on_conflict_do_update(
            constraint="uq_veteran_tag_trained_chara_id", set_={"tag": tag}
        )
    )
    await session.execute(stmt)
    await session.commit()
    return {"trained_chara_id": trained_chara_id, "tag": tag}


@router.delete("/veterans/{trained_chara_id}/tags/{tag}", status_code=204)
async def remove_tag(
    trained_chara_id: int,
    tag: str,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    """Clear the veteran's mark. Under the one-mark model the path's {tag} is
    advisory only — a stale client naming the old mark must still clear the
    current one, so we delete whatever the veteran carries.
    """
    del tag
    row = await session.scalar(
        select(VeteranTag).where(
            VeteranTag.owner_id == user.id,
            VeteranTag.trained_chara_id == trained_chara_id,
        )
    )
    if row:
        await session.delete(row)
        await session.commit()
