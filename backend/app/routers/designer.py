"""Designer routes: the chara catalog, stateless affinity scoring, and
saved-blueprint CRUD."""
from __future__ import annotations

from typing import get_args

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import affinity, reference
from ..database import get_session
from ..models import Blueprint
from ..schemas import (
    AffinityIn,
    AffinityOut,
    BlueprintIn,
    BlueprintOut,
    CatalogCardOut,
    CatalogEntryOut,
    PickableFactorOut,
    SlotFactorKind,
)

router = APIRouter(prefix="/api")

# Built once — the relation reference is static for the process lifetime, and
# scoring against it is microseconds, so /api/affinity stays stateless
# (DECISIONS.md #17): no DB reads, no precomputed scores to go stale.
RELATION_TABLE = affinity.build_relation_table(
    reference.RELATION_POINTS, reference.RELATION_MEMBERS
)


# ---------- catalog ----------

def _build_catalog() -> list[CatalogEntryOut]:
    cards_by_chara: dict[int, list[int]] = {}
    for card_id, card in reference.CARDS.items():
        # 7-digit ids are the NPC/tutorial copies of real cards — same chara,
        # same outfit label, no aptitude rows. Serving them would put an
        # indistinguishable letter-less duplicate next to every real pick.
        if card_id > 999_999:
            continue
        cards_by_chara.setdefault(card["chara_id"], []).append(card_id)
    entries = [
        CatalogEntryOut(
            chara_id=chara_id,
            name=reference.CARDS[card_ids[0]]["name"],
            cards=[
                CatalogCardOut(
                    card_id=card_id,
                    outfit=reference.CARDS[card_id]["outfit"],
                    # .get(): every playable card has letters today, but a
                    # cards.json regen can run ahead of aptitudes.json.
                    aptitudes=reference.APTITUDES.get(card_id),
                )
                for card_id in card_ids
            ],
        )
        for chara_id, card_ids in (
            (cid, sorted(ids)) for cid, ids in cards_by_chara.items()
        )
    ]
    entries.sort(key=lambda entry: (entry.name, entry.chara_id))
    return entries


# Static per process, like the reference data it derives from.
CATALOG = _build_catalog()


@router.get("/catalog", response_model=list[CatalogEntryOut])
async def get_catalog():
    """Every known character (deduped across outfits) for theoretical slot
    picks in the blueprint designer."""
    return CATALOG


# ---------- spark reference ----------
# The kinds a designed node can be given by hand, from the game's own factor
# table. Served rather than bundled into the frontend: it is the same
# committed reference the decoder reads, so one regen keeps the names a dump
# decodes to and the names you can pick from in step — they would drift the
# moment one was copied.
PICKABLE_KINDS: tuple[SlotFactorKind, ...] = get_args(SlotFactorKind)


def _pickable_factors() -> list[PickableFactorOut]:
    out: list[PickableFactorOut] = []
    for key, info in reference.FACTORS.items():
        kind = reference.FACTOR_TYPE_KINDS.get(info["type"])
        # Narrowed against the Literal rather than a set membership test, so
        # the kinds a slot may hold stay defined in exactly one place.
        for pickable in PICKABLE_KINDS:
            if kind == pickable:
                out.append(PickableFactorOut(kind=pickable, key=key, name=info["name"]))
                break
    return sorted(out, key=lambda f: (f.kind, f.name))


PICKABLE_FACTORS = _pickable_factors()


@router.get("/factors", response_model=list[PickableFactorOut])
async def get_factors():
    """Every non-pink spark a designed node can be given by hand — white,
    unique (green), race and scenario."""
    return PICKABLE_FACTORS


# ---------- affinity ----------

@router.post("/affinity", response_model=AffinityOut)
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

@router.get("/blueprints", response_model=list[BlueprintOut])
async def list_blueprints(session: AsyncSession = Depends(get_session)):
    return (
        await session.scalars(
            select(Blueprint).order_by(Blueprint.updated_at.desc(), Blueprint.id.desc())
        )
    ).all()


@router.post("/blueprints", response_model=BlueprintOut, status_code=201)
async def create_blueprint(
    body: BlueprintIn,
    session: AsyncSession = Depends(get_session),
):
    blueprint = Blueprint(
        name=body.name,
        slots=body.slots.model_dump(),
    )
    session.add(blueprint)
    await session.commit()
    await session.refresh(blueprint)
    return blueprint


@router.put("/blueprints/{blueprint_id}", response_model=BlueprintOut)
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
    blueprint.slots = body.slots.model_dump()
    # Explicit: onupdate only fires when a column changed, but the saved-list
    # is ordered by updated_at, so an identical re-save must still rise.
    blueprint.updated_at = func.now()
    await session.commit()
    await session.refresh(blueprint)
    return blueprint


@router.delete("/blueprints/{blueprint_id}", status_code=204)
async def delete_blueprint(
    blueprint_id: int,
    session: AsyncSession = Depends(get_session),
):
    blueprint = await session.get(Blueprint, blueprint_id)
    if blueprint is None:
        raise HTTPException(404, "no blueprint with that id")
    await session.delete(blueprint)
    await session.commit()
