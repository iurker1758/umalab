"""Spark-list routes: the user's named lists of sparks they want
(DECISIONS.md #37, issue #39).

Its own router rather than a section of designer.py for the same reason the
frontend gives it its own module: three features read these — the spark
chooser's Favorites section (#28), the proc tables' watched block (#27) and
hunted-skill scoring — and only one of them is the designer's blueprint CRUD.

An ordinary REST shape rather than #33's upsert-by-identity PUT: a list's
identity is a server-assigned id, so the client cannot name a row that does
not exist yet. Creating and editing are therefore different requests, which
is what POST/PATCH is for.

Membership is rows in `spark_list_members`, added and removed one at a time
through PUT/DELETE on the member path (issue #66, DECISIONS.md #48). Two
devices editing one list commute instead of overwriting each other's whole
array; both verbs are idempotent, so the state named in the path is the
state you get; and a 404 concerns one membership, which lets a stale client
drop a deleted list in place instead of retrying a dead whole-array write.
"""
from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from typing import Annotated, Any, cast

from fastapi import APIRouter, Depends, HTTPException, Path, Response
from sqlalchemy import CursorResult, Result, delete, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import current_user
from ..database import get_session
from ..models import SparkList, SparkListMember, User
from ..schemas import (
    MAX_LISTS_PER_OWNER,
    ListSparkKind,
    SparkListCreate,
    SparkListOut,
    SparkListPatch,
    SparkRef,
)

router = APIRouter(prefix="/api")

# Both are 409s and the client shows whichever it is given, so they have to
# say different things — "the name may already be in use" in front of a user
# who has hit the list cap sends them to rename a list four times over.
# "ignoring case" because the index folds it: two visibly different names can
# collide, and a message that doesn't say so reads as a bug.
_DUPLICATE_NAME = "you already have a list with that name, ignoring case"
_AT_CAP = f"you already have {MAX_LISTS_PER_OWNER} lists — delete one first"
# The unique expression index, by the name the migration gives it. Postgres
# reports it in the violation, which is the only thing distinguishing "that
# name is taken" from every other integrity failure.
_NAME_INDEX = "uq_spark_list_owner_lower_name"

# int4, matching SparkRef.key's bound: an oversized key is unrepresentable
# everywhere else the app puts a factor id.
_Key = Annotated[int, Path(ge=1, le=2_147_483_647)]


def _changed(result: Result[Any]) -> bool:
    """Whether this DML statement touched a row. `session.execute` is typed
    as the base Result, which hides `rowcount`; DML always comes back as a
    CursorResult, which carries it."""
    return cast(CursorResult[Any], result).rowcount > 0


def _duplicate_name(exc: IntegrityError) -> bool:
    """Whether this violation is the name index, rather than some other
    constraint wearing its error message.

    Every IntegrityError used to become "you already have a list with that
    name", which sends the user renaming over a foreign-key or not-null
    failure that renaming cannot fix.
    """
    return _NAME_INDEX in str(getattr(exc, "orig", exc))


async def _owned(session: AsyncSession, user: User, list_id: int) -> SparkList | None:
    """The caller's list, or None. Never another owner's — a wrong id and
    someone else's id give the same answer, so these routes cannot be used
    to probe for rows that exist."""
    return await session.scalar(
        select(SparkList).where(
            SparkList.id == list_id, SparkList.owner_id == user.id
        )
    )


async def _members_of(
    session: AsyncSession, list_id: int
) -> Sequence[SparkListMember]:
    """One list's members in `id` order — the order they were added, which
    is the display order the old array's order used to carry."""
    return (
        await session.scalars(
            select(SparkListMember)
            .where(SparkListMember.list_id == list_id)
            .order_by(SparkListMember.id)
        )
    ).all()


def _out(row: SparkList, members: Sequence[SparkListMember]) -> SparkListOut:
    """Assembled by hand because there is no relationship to map — house
    style is FKs and explicit queries. `model_validate` per member so the
    Literal kind is checked at the boundary; the CHECK constraint is what
    guarantees it can never fail."""
    return SparkListOut(
        id=row.id,
        name=row.name,
        updated_at=row.updated_at,
        sparks=[
            SparkRef.model_validate({"kind": member.kind, "key": member.key})
            for member in members
        ],
    )


async def _touched(session: AsyncSession, row: SparkList) -> SparkListOut:
    """Commit a membership write, bump nothing further, and answer with the
    list's current state — the response every membership verb shares, so a
    toggle folds in whatever other devices have done in the meantime."""
    await session.commit()
    # `updated_at` may be expired by the commit; reading it without this
    # refresh lazy-loads outside the async context and 500s.
    await session.refresh(row)
    return _out(row, await _members_of(session, row.id))


@router.get("/spark-lists", response_model=list[SparkListOut])
async def list_spark_lists(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    """Every list this user has, in creation order.

    `id` order, which is total and stable — the management page re-sorts
    client-side per its own selector (name, newest, last edited), so the
    wire order only has to never move between reads (DECISIONS.md #44).

    Never filtered against the factor reference: a spark missing from
    `app/data` is still a legitimate thing to want, and dropping it here
    would be the reconcile pass #37 rules out.
    """
    rows = (
        await session.scalars(
            select(SparkList)
            .where(SparkList.owner_id == user.id)
            .order_by(SparkList.id)
        )
    ).all()
    grouped: dict[int, list[SparkListMember]] = defaultdict(list)
    if rows:
        members = await session.scalars(
            select(SparkListMember)
            .where(SparkListMember.list_id.in_([row.id for row in rows]))
            .order_by(SparkListMember.id)
        )
        for member in members:
            grouped[member.list_id].append(member)
    return [_out(row, grouped[row.id]) for row in rows]


@router.post("/spark-lists", response_model=SparkListOut, status_code=201)
async def create_spark_list(
    body: SparkListCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    """Create an empty list.

    Empty is the normal case and the reason this table exists: the picker's
    `New List` is reached while starring a spark, so the list is created and
    then filled by the membership write that follows. #33's derived group
    vocabulary could not express this state at all.
    """
    # Serializes concurrent creates FOR THIS OWNER. The count below is a
    # check-then-act: without this, two requests can both read 49, both pass,
    # and both insert, leaving 51 rows on a cap meant to bound the table.
    #
    # An advisory lock rather than SERIALIZABLE (retry logic on every caller),
    # a `FOR UPDATE` on `users` (makes an unrelated table the gate), or a slot
    # column with a CHECK (declarative, but leaves holes on delete and makes
    # every create hunt for a free index).
    # Transaction-scoped, so it goes at commit or rollback with no unlock to
    # forget, and keyed on the owner, so the only thing that ever waits is one
    # user creating two lists at once.
    await session.execute(select(func.pg_advisory_xact_lock(user.id)))
    # Owner-scoped, which `test_the_cap_is_per_owner` pins.
    count = await session.scalar(
        select(func.count())
        .select_from(SparkList)
        .where(SparkList.owner_id == user.id)
    )
    if (count or 0) >= MAX_LISTS_PER_OWNER:
        raise HTTPException(409, _AT_CAP)
    row = SparkList(owner_id=user.id, name=body.name)
    session.add(row)
    try:
        await session.commit()
    except IntegrityError as exc:
        # The name index. Anything else is a real fault, re-raised rather than
        # dressed up as a name the user can change.
        await session.rollback()
        if not _duplicate_name(exc):
            raise
        raise HTTPException(409, _DUPLICATE_NAME) from None
    # `updated_at` is DB-generated, so it is expired after the commit —
    # reading it without this refresh lazy-loads outside the async context
    # and 500s.
    await session.refresh(row)
    return _out(row, [])


@router.patch("/spark-lists/{list_id}", response_model=SparkListOut)
async def update_spark_list(
    list_id: int,
    body: SparkListPatch,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    """Rename it. Membership has its own verbs below; a body carrying
    `sparks` is a stale client and 422s loudly (schemas.SparkListPatch).

    404 rather than DELETE's silent success when the list is gone: "rename
    this list" is not satisfied by the list not existing, and a client told
    it succeeded would show a name nothing stored.
    """
    row = await _owned(session, user, list_id)
    if row is None:
        raise HTTPException(404, "no such list")
    if body.name is not None:
        row.name = body.name
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        if not _duplicate_name(exc):
            raise
        raise HTTPException(409, _DUPLICATE_NAME) from None
    await session.refresh(row)
    return _out(row, await _members_of(session, row.id))


@router.put(
    "/spark-lists/{list_id}/sparks/{kind}/{key}", response_model=SparkListOut
)
async def add_list_spark(
    list_id: int,
    kind: ListSparkKind,
    key: _Key,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    """Put this spark in the list. Idempotent: already-in-it is the state
    the caller asked for, so it answers 200 with the member keeping its
    original place — and no `updated_at` bump, because nothing was edited.

    A single-row insert, which is the point (issue #66): two devices adding
    different sparks commute, and neither ever writes over the other.
    """
    row = await _owned(session, user, list_id)
    if row is None:
        raise HTTPException(404, "no such list")
    result = await session.execute(
        pg_insert(SparkListMember)
        .values(list_id=row.id, kind=kind, key=key)
        .on_conflict_do_nothing(index_elements=["list_id", "kind", "key"])
    )
    if _changed(result):
        # Member writes don't touch this row, and the model's `onupdate`
        # only fires on an ORM flush of the row itself — bumped by hand so
        # the management page's "Last Edited" sort stays honest.
        await session.execute(
            update(SparkList)
            .where(SparkList.id == row.id)
            .values(updated_at=func.now())
        )
    return await _touched(session, row)


@router.delete(
    "/spark-lists/{list_id}/sparks/{kind}/{key}", response_model=SparkListOut
)
async def remove_list_spark(
    list_id: int,
    kind: ListSparkKind,
    key: _Key,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    """Take this spark out of the list. Idempotent like the add; already
    absent answers 200 unbumped.

    200 with the list rather than the list DELETE's 204: the caller keeps
    rendering this list and wants the state it just changed.
    """
    row = await _owned(session, user, list_id)
    if row is None:
        raise HTTPException(404, "no such list")
    result = await session.execute(
        delete(SparkListMember).where(
            SparkListMember.list_id == row.id,
            SparkListMember.kind == kind,
            SparkListMember.key == key,
        )
    )
    if _changed(result):
        await session.execute(
            update(SparkList)
            .where(SparkList.id == row.id)
            .values(updated_at=func.now())
        )
    return await _touched(session, row)


@router.delete("/spark-lists/{list_id}", status_code=204)
async def delete_spark_list(
    list_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    """Already gone is the outcome the caller wanted, so this never 404s —
    the same rule the blueprint delete follows on the client side.

    Deleting a list deletes its membership: the member table's FK cascades
    at the DB, so nothing is left behind to sweep — the property
    DECISIONS.md #37 chose this side of the relationship for, kept by #48.
    """
    row = await _owned(session, user, list_id)
    if row is not None:
        await session.delete(row)
        await session.commit()
    return Response(status_code=204)
