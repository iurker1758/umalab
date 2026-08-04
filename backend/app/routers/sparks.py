"""Watched-spark routes: the one list of sparks a user cares about
(DECISIONS.md #33, issue #39).

Its own router rather than a section of designer.py for the same reason the
frontend gives it its own module: three features read it — the spark chooser
(#28), the proc tables' watched block (#27) and hunted-skill scoring — and
only one of them is the designer's blueprint CRUD.

Three routes. (kind, key) is the identity and travels in the path; the body
carries whichever of the two mutable fields the caller means to change, and
an omitted one is left as it is (issue #64).

That last part reverses this module's original ruling — "no partial updates;
a PATCH would buy nothing and would need its own 'absent means unchanged'
rules on a two-field object". The rules turned out to be one line each, and
the full replace was not free: it forced the client to send fields it was not
changing, so it had to *know* them, so every mutator re-read the whole list
first — and the one that forgot destroyed a user's groups (#62). It stays a
PUT rather than becoming a PATCH: this is still an upsert on an identity the
caller names, which is what PUT is for.
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


def _apply(row: WatchedSpark, body: WatchedSparkIn) -> None:
    """Set only what the body carried — absent (or null) leaves the field.

    On a row being created, "left alone" means the column default takes it,
    which is where "new sparks are hunted" is stated. Applied in both arms of
    the insert race below, so the loser of that race lands on the same rules
    as the winner.
    """
    if body.hunting is not None:
        row.hunting = body.hunting
    if body.groups is not None:
        row.groups = body.groups


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
    """Add the spark, or change whichever fields the body carries on the one
    already there. Upsert rather than POST-then-PATCH: the client's three
    operations (add, set hunting, set groups) are all "this is the row I
    want", and an add that 409s on an existing row would just make every
    caller do a lookup first.

    An empty body is therefore a complete request: "make sure this spark is
    watched, and leave it as it is if it already was". That is exactly what
    the client's `toggle` means, and it can now say it without first finding
    out whether the row exists.

    An existing row keeps its `id`, so re-hunting a spark does not move it to
    the end of the list. A row being created takes its defaults from the
    columns, so "new sparks are hunted" is stated once (models.WatchedSpark)
    rather than guessed by whoever is adding.
    """
    row = await _row(session, user, kind, key)
    if row is None:
        row = WatchedSpark(owner_id=user.id, kind=kind, key=key)
        session.add(row)
    _apply(row, body)
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
        _apply(existing, body)
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
