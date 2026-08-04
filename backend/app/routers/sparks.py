"""Spark-list routes: the user's named lists of sparks they want
(DECISIONS.md #37, issue #39).

Its own router rather than a section of designer.py for the same reason the
frontend gives it its own module: three features read these — the spark
chooser's Favorites section (#28), the proc tables' watched block (#27) and
hunted-skill scoring — and only one of them is the designer's blueprint CRUD.

Four routes, and an ordinary REST shape rather than #33's upsert-by-identity
PUT: a list's identity is a server-assigned id, so the client cannot name a
row that does not exist yet. Creating and editing are therefore different
requests, which is what POST/PATCH is for.

Membership is a field on the list, so adding or removing a spark is a PATCH
carrying the whole `sparks` array. That makes concurrent edits to one list
last-write-wins — accepted rather than solved, and #37 says why and what
closing it would cost.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import current_user
from ..database import get_session
from ..models import SparkList, User
from ..schemas import (
    MAX_LISTS_PER_OWNER,
    SparkListCreate,
    SparkListOut,
    SparkListPatch,
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


@router.get("/spark-lists", response_model=list[SparkListOut])
async def list_spark_lists(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    """Every list this user has, in the order they curate.

    Ties break on `id` so the order is total — two lists created without an
    explicit position both sit at the default until something reorders them,
    and a list must not jump around between reads.

    Never filtered against the factor reference: a spark missing from
    `app/data` is still a legitimate thing to want, and dropping it here
    would be the reconcile pass #37 rules out.
    """
    return (
        await session.scalars(
            select(SparkList)
            .where(SparkList.owner_id == user.id)
            .order_by(SparkList.position, SparkList.id)
        )
    ).all()


@router.post("/spark-lists", response_model=SparkListOut, status_code=201)
async def create_spark_list(
    body: SparkListCreate,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    """Create an empty list, appended to the end of the user's order.

    Empty is the normal case and the reason this table exists: the picker's
    `New List` is reached while starring a spark, so the list is created and
    then filled by the PATCH that follows. #33's derived group vocabulary
    could not express this state at all.
    """
    # Serializes concurrent creates FOR THIS OWNER. The count below is a
    # check-then-act: without this, two requests can both read 49, both pass,
    # and both insert, leaving 51 rows on a cap meant to bound the table.
    #
    # An advisory lock rather than SERIALIZABLE (retry logic on every caller)
    # or a `FOR UPDATE` on `users` (makes an unrelated table the gate).
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
    # Append: one past the current maximum, so a new list never lands in the
    # middle of an order the user arranged. `None` on the very first list.
    last = await session.scalar(
        select(func.max(SparkList.position)).where(SparkList.owner_id == user.id)
    )
    row = SparkList(
        owner_id=user.id, name=body.name, position=0 if last is None else last + 1
    )
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
    await session.refresh(row)
    return row


@router.patch("/spark-lists/{list_id}", response_model=SparkListOut)
async def update_spark_list(
    list_id: int,
    body: SparkListPatch,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    """Rename it, reorder it, or set its membership — whichever the body
    carries. An omitted field is left alone, so the picker sends `sparks`
    without having to know or guess the list's current name.

    404 rather than DELETE's silent success when the list is gone: "make
    this list hold these sparks" is not satisfied by the list not existing,
    and a client told it succeeded would show membership nothing stored.
    """
    row = await _owned(session, user, list_id)
    if row is None:
        raise HTTPException(404, "no such list")
    if body.name is not None:
        row.name = body.name
    if body.position is not None:
        row.position = body.position
    if body.sparks is not None:
        # JSONB wants plain data. Dumped from the validated models, so what
        # lands in the column is exactly what SparkRef allows.
        row.sparks = [spark.model_dump() for spark in body.sparks]
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        if not _duplicate_name(exc):
            raise
        raise HTTPException(409, _DUPLICATE_NAME) from None
    return row


@router.delete("/spark-lists/{list_id}", status_code=204)
async def delete_spark_list(
    list_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    """Already gone is the outcome the caller wanted, so this never 404s —
    the same rule the blueprint delete follows on the client side.

    Deleting a list deletes its membership, because the membership is a
    column on it. That is the whole argument for this shape over the two
    that keep membership on the spark (DECISIONS.md #37): nothing is left
    behind to sweep.
    """
    row = await _owned(session, user, list_id)
    if row is not None:
        await session.delete(row)
        await session.commit()
    return Response(status_code=204)
