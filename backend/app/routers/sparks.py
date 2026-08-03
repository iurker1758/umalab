"""Watched-spark routes: the one list of sparks a user cares about
(DECISIONS.md #33, issue #39).

Its own router rather than a section of designer.py for the same reason the
frontend gives it its own module: three features read it — the spark chooser
(#28), the proc tables' watched block (#27) and hunted-skill scoring — and
only one of them is the designer's blueprint CRUD.

Three routes, no partial updates. (kind, key) is the identity and travels in
the path; the body is the whole mutable half of the row, which the client
already has in hand. A PATCH would buy nothing and would need its own
"absent means unchanged" rules on a two-field object.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import current_user
from ..database import get_session
from ..models import User, WatchedSpark
from ..schemas import SlotFactorKind, WatchedSparkIn, WatchedSparkOut

router = APIRouter(prefix="/api")


async def _row(
    session: AsyncSession, user: User, kind: SlotFactorKind, key: int
) -> WatchedSpark | None:
    return await session.scalar(
        select(WatchedSpark).where(
            WatchedSpark.owner_id == user.id,
            WatchedSpark.kind == kind,
            WatchedSpark.key == key,
        )
    )


@router.get("/watched-sparks", response_model=list[WatchedSparkOut])
async def list_watched(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    """Insertion order, oldest first — the order the chooser lists them in.

    Never filtered against the factor reference: a watched spark missing from
    `app/data` is still a legitimate thing to want, and dropping it here would
    be the reconcile pass #39 rules out.
    """
    return (
        await session.scalars(
            select(WatchedSpark)
            .where(WatchedSpark.owner_id == user.id)
            .order_by(WatchedSpark.id)
        )
    ).all()


@router.put("/watched-sparks/{kind}/{key}", response_model=WatchedSparkOut)
async def watch(
    kind: SlotFactorKind,
    key: int,
    body: WatchedSparkIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    """Add the spark, or replace the bit and the groups on the one already
    there. Upsert rather than POST-then-PATCH: the client's three operations
    (add, set hunting, set groups) are all "this is the row I want", and an
    add that 409s on an existing row would just make every caller do a lookup
    first.

    An existing row keeps its `id`, so re-hunting a spark does not move it to
    the end of the list.
    """
    row = await _row(session, user, kind, key)
    if row is None:
        row = WatchedSpark(owner_id=user.id, kind=kind, key=key)
        session.add(row)
    row.hunting = body.hunting
    row.groups = body.groups
    try:
        await session.commit()
    except IntegrityError:
        # Read-then-insert: two requests for the same (kind, key) — a
        # double-clicked control, or a chooser click and a hunting toggle in
        # the same tick — can both find nothing and both insert, and the
        # loser hits uq_watched_spark_owner_kind_key. The row it wanted now
        # exists, so apply to that one rather than 500ing.
        # `auth.user_for_email` handles the same race the same way.
        await session.rollback()
        existing = await _row(session, user, kind, key)
        if existing is None:
            raise
        existing.hunting = body.hunting
        existing.groups = body.groups
        await session.commit()
        row = existing
    await session.refresh(row)
    return row


@router.delete("/watched-sparks/{kind}/{key}", status_code=204)
async def unwatch(
    kind: SlotFactorKind,
    key: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    """Already gone is the outcome the caller wanted, so this never 404s —
    the same rule the blueprint delete follows on the client side."""
    row = await _row(session, user, kind, key)
    if row is not None:
        await session.delete(row)
        await session.commit()
    return Response(status_code=204)
