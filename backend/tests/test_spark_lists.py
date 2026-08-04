"""The user's spark lists (DECISIONS.md #37, issue #39).

Database-backed for the same reason test_isolation.py is: what these assert
is the table — the curated order, per-owner name uniqueness, and that nothing
here filters against the factor reference. Fixtures come from conftest.py, so
the skip/PYTEST_REQUIRE_DB rules apply identically.

These replace test_watched_sparks.py wholesale. #33's shape had a `hunting`
bit and a derived group vocabulary; #37 holds why the axis was wrong and what
each of its rulings became.
"""
from __future__ import annotations

import asyncio
from typing import Any

import pytest
from fastapi.exceptions import ResponseValidationError
from sqlalchemy import text

from app.models import User

LISTS = "/api/spark-lists"


async def create(as_user: Any, user: User, name: str):
    async with as_user(user) as http:
        return await http.post(LISTS, json={"name": name})


async def patch(as_user: Any, user: User, list_id: int, **body: Any):
    async with as_user(user) as http:
        return await http.patch(f"{LISTS}/{list_id}", json=body)


async def listing(as_user: Any, user: User) -> list[dict[str, Any]]:
    async with as_user(user) as http:
        response = await http.get(LISTS)
    assert response.status_code == 200
    return response.json()


async def a_list(as_user: Any, user: User, name: str = "Front Runner") -> int:
    response = await create(as_user, user, name)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def spark(kind: str, key: int) -> dict[str, Any]:
    return {"kind": kind, "key": key}


# ---------- the row ----------

async def test_a_list_round_trips(client: Any, users: list[User]):
    a, _ = users
    response = await create(client, a, "Front Runner")
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["id"] > 0
    assert body["name"] == "Front Runner"
    assert body["position"] == 0
    assert body["sparks"] == []
    assert await listing(client, a) == [body]


async def test_a_list_is_created_empty_and_stays(client: Any, users: list[User]):
    """The state #33's derived group vocabulary could not represent at all: a
    named list with nothing in it. The picker's `New List` creates one and the
    PATCH that fills it is a separate request, so this has to survive a read.
    """
    a, _ = users
    await a_list(client, a, "Medium")
    assert [(row["name"], row["sparks"]) for row in await listing(client, a)] == [
        ("Medium", [])
    ]


async def test_a_name_is_trimmed(client: Any, users: list[User]):
    a, _ = users
    response = await create(client, a, "  Front Runner ")
    assert response.json()["name"] == "Front Runner"


@pytest.mark.parametrize("name", ["", "   ", "x" * 41])
async def test_an_unusable_name_is_refused(
    client: Any, users: list[User], name: str
):
    a, _ = users
    assert (await create(client, a, name)).status_code == 422


async def test_a_duplicate_name_is_refused(client: Any, users: list[User]):
    """The name is how the user tells lists apart in the picker, so two with
    the same one is a control you cannot use."""
    a, _ = users
    await a_list(client, a, "Front Runner")
    response = await create(client, a, "Front Runner")
    assert response.status_code == 409
    assert len(await listing(client, a)) == 1


async def test_a_duplicate_name_is_refused_after_trimming(
    client: Any, users: list[User]
):
    """Trimming happens before the index sees it, so the whitespace variant
    collides rather than creating a second list that looks identical."""
    a, _ = users
    await a_list(client, a, "Front Runner")
    assert (await create(client, a, " Front Runner")).status_code == 409


@pytest.mark.parametrize("variant", ["front runner", "FRONT RUNNER", "Front runner"])
async def test_a_name_differing_only_in_case_is_refused(
    client: Any, users: list[User], variant: str
):
    """Folded, because this is a phone-first PWA and mobile keyboards
    autocapitalise — "Front Runner" on the desktop and "Front runner" on the
    phone is a thing that happens by itself. Byte-exact uniqueness would let
    them coexist as two visually identical pills holding different
    membership (DECISIONS.md #37)."""
    a, _ = users
    await a_list(client, a, "Front Runner")
    assert (await create(client, a, variant)).status_code == 409
    assert len(await listing(client, a)) == 1


async def test_the_stored_name_keeps_the_case_it_was_typed_in(
    client: Any, users: list[User]
):
    """Folded for COMPARISON only. The name is the user's, and lowercasing
    what they typed would be the app editing their label."""
    a, _ = users
    response = await create(client, a, "FRONT Runner")
    assert response.json()["name"] == "FRONT Runner"


async def test_renaming_onto_a_case_variant_is_refused(
    client: Any, users: list[User]
):
    """The index covers the PATCH too, not just the create."""
    a, _ = users
    await a_list(client, a, "Front Runner")
    second = await a_list(client, a, "Medium")
    assert (await patch(client, a, second, name="front runner")).status_code == 409


async def test_two_users_may_hold_case_variants_of_one_name(
    client: Any, users: list[User]
):
    """The fold is per owner, like the name itself."""
    a, b = users
    await a_list(client, a, "Front Runner")
    assert (await create(client, b, "front runner")).status_code == 201


# ---------- order ----------

async def test_new_lists_append(client: Any, users: list[User]):
    a, _ = users
    for name in ("Front Runner", "Medium", "Long"):
        await a_list(client, a, name)
    assert [row["name"] for row in await listing(client, a)] == [
        "Front Runner",
        "Medium",
        "Long",
    ]
    assert [row["position"] for row in await listing(client, a)] == [0, 1, 2]


async def test_position_decides_the_order(client: Any, users: list[User]):
    """Explicit rather than `id` order, so reordering is a PATCH and not a
    delete-and-recreate."""
    a, _ = users
    first = await a_list(client, a, "Front Runner")
    await a_list(client, a, "Medium")
    assert (await patch(client, a, first, position=99)).status_code == 200
    assert [row["name"] for row in await listing(client, a)] == [
        "Medium",
        "Front Runner",
    ]


async def test_ties_break_on_id(client: Any, users: list[User]):
    """Two lists at the same position must not swap places between reads."""
    a, _ = users
    first = await a_list(client, a, "Front Runner")
    second = await a_list(client, a, "Medium")
    for list_id in (first, second):
        await patch(client, a, list_id, position=0)
    assert [row["id"] for row in await listing(client, a)] == [first, second]


# ---------- membership ----------

async def test_setting_membership(client: Any, users: list[User]):
    a, _ = users
    list_id = await a_list(client, a)
    response = await patch(
        client, a, list_id, sparks=[spark("white", 2010), spark("race", 40)]
    )
    assert response.status_code == 200, response.text
    assert response.json()["sparks"] == [spark("white", 2010), spark("race", 40)]


async def test_membership_keeps_the_order_it_was_sent_in(
    client: Any, users: list[User]
):
    """The array's order IS the list's order — what the picker appends to and
    what the list renders."""
    a, _ = users
    list_id = await a_list(client, a)
    sent = [spark("white", 30), spark("white", 10), spark("white", 20)]
    assert (await patch(client, a, list_id, sparks=sent)).json()["sparks"] == sent


async def test_the_same_key_under_a_different_kind_is_a_different_spark(
    client: Any, users: list[User]
):
    """Identity is (kind, key), not key — the kinds' id ranges are an ingest
    heuristic rather than a guarantee, so dedupe must not collapse these."""
    a, _ = users
    list_id = await a_list(client, a)
    sent = [spark("white", 1), spark("race", 1)]
    assert (await patch(client, a, list_id, sparks=sent)).json()["sparks"] == sent


async def test_duplicates_collapse_keeping_the_first(client: Any, users: list[User]):
    """The client sends the list's whole membership and "already in it" is the
    state it asked for, so this is a 200 rather than a 422. First occurrence
    wins so the order the user built survives the collapse."""
    a, _ = users
    list_id = await a_list(client, a)
    response = await patch(
        client,
        a,
        list_id,
        sparks=[spark("white", 10), spark("white", 20), spark("white", 10)],
    )
    assert response.status_code == 200
    assert response.json()["sparks"] == [spark("white", 10), spark("white", 20)]


async def test_a_repeated_spark_collapses_rather_than_being_refused(
    client: Any, users: list[User]
):
    """The client sends the whole membership and "already in it" is the state
    it asked for, so a repeat is a 200."""
    a, _ = users
    list_id = await a_list(client, a)
    response = await patch(client, a, list_id, sparks=[spark("white", 10)] * 300)
    assert response.status_code == 200
    assert response.json()["sparks"] == [spark("white", 10)]


async def test_membership_is_unbounded(client: Any, users: list[User]):
    """No cap, deliberately. The chooser adds from the factor reference, so
    the reachable maximum IS the reference size — 432 today and growing every
    time the game ships skills — and any constant either binds too early or
    ages into binding too early. An earlier cut used 200 while 256 whites
    alone could pass it.

    1000 here is well past today's reference precisely to show nothing
    refuses it."""
    a, _ = users
    list_id = await a_list(client, a)
    sparks = [spark("white", n) for n in range(1, 1001)]
    response = await patch(client, a, list_id, sparks=sparks)
    assert response.status_code == 200, response.text
    assert len(response.json()["sparks"]) == 1000


async def test_an_unreadable_entry_fails_the_read_rather_than_vanishing(
    client: Any, users: list[User], sessions: Any
):
    """LOUD, on purpose, and this is the accepted tradeoff rather than an
    oversight.

    A lenient read was written and reverted. Membership is a whole-array
    PATCH, so an entry the response quietly drops is missing from the
    client's copy and is DELETED by that client's next write — silent,
    permanent data loss on the first pill click. Failing the read keeps the
    row intact: nothing has told the client a truncated array is the truth.

    The cost is the `BlueprintOut` failure CLAUDE.md records — one bad row
    takes the whole list response with it — which is filed rather than
    papered over, because the fix that actually helps is a lossless round
    trip (#66), not a quieter loss.

    Written straight to the column, because the request model refuses this.
    """
    a, _ = users
    first = await a_list(client, a, "Front Runner")
    await patch(client, a, first, sparks=[spark("white", 10)])
    async with sessions() as session:
        await session.execute(
            text(
                "UPDATE spark_lists SET sparks = CAST(:s AS jsonb) WHERE id = :i"
            ).bindparams(
                s='[{"kind": "white", "key": 10}, {"kind": "blue", "key": 70}]',
                i=first,
            )
        )
        await session.commit()
    # The ASGI test client re-raises server exceptions rather than
    # returning the 500 a browser would see; either way the read fails
    # loudly, which is the point.
    with pytest.raises(ResponseValidationError):
        async with client(a) as http:
            await http.get(LISTS)
    # The row is untouched by the failed read — nothing has been dropped.
    async with sessions() as session:
        stored = await session.scalar(
            text("SELECT jsonb_array_length(sparks) FROM spark_lists WHERE id = :i")
            .bindparams(i=first)
        )
    assert stored == 2


async def test_an_unknown_key_is_accepted(client: Any, users: list[User]):
    """No validation against the factor reference, matching blueprint factors:
    app/data is regenerated by hand and can run behind a dump, and a spark
    missing from it is still a legitimate thing to want."""
    a, _ = users
    list_id = await a_list(client, a)
    response = await patch(client, a, list_id, sparks=[spark("white", 999_999)])
    assert response.status_code == 200
    assert response.json()["sparks"] == [spark("white", 999_999)]


async def test_an_unknown_kind_is_refused(client: Any, users: list[User]):
    """`kind` decides the proc base rate, so unlike `key` it is closed."""
    a, _ = users
    list_id = await a_list(client, a)
    assert (await patch(client, a, list_id, sparks=[spark("blue", 1)])).status_code == 422


async def test_a_mis_keyed_spark_entry_is_refused(client: Any, users: list[User]):
    a, _ = users
    list_id = await a_list(client, a)
    response = await patch(
        client, a, list_id, sparks=[{"kind": "white", "key": 1, "stars": 3}]
    )
    assert response.status_code == 422


# ---------- partial updates ----------
# The one thing about #33's request shape that carried over intact: an omitted
# field is left alone, and an explicit empty array is a different request from
# a missing key.


async def test_setting_membership_leaves_the_name(client: Any, users: list[User]):
    a, _ = users
    list_id = await a_list(client, a, "Front Runner")
    response = await patch(client, a, list_id, sparks=[spark("white", 10)])
    assert response.json()["name"] == "Front Runner"


async def test_renaming_leaves_the_membership(client: Any, users: list[User]):
    """A rename is one row and one field — the whole reason lists are their
    own table rather than a name repeated across every spark that holds it."""
    a, _ = users
    list_id = await a_list(client, a, "Front Runner")
    await patch(client, a, list_id, sparks=[spark("white", 10)])
    response = await patch(client, a, list_id, name="Front")
    assert response.json()["name"] == "Front"
    assert response.json()["sparks"] == [spark("white", 10)]


async def test_an_empty_patch_changes_nothing(client: Any, users: list[User]):
    a, _ = users
    list_id = await a_list(client, a, "Front Runner")
    await patch(client, a, list_id, sparks=[spark("white", 10)])
    response = await patch(client, a, list_id)
    assert response.status_code == 200
    assert response.json()["name"] == "Front Runner"
    assert response.json()["sparks"] == [spark("white", 10)]


@pytest.mark.parametrize("field", ["name", "position", "sparks"])
async def test_an_explicit_null_leaves_the_field_alone(
    client: Any, users: list[User], field: str
):
    """Absent and null mean the same thing, so a client serializing an unset
    field as null gets the same answer as one omitting it."""
    a, _ = users
    list_id = await a_list(client, a, "Front Runner")
    await patch(client, a, list_id, sparks=[spark("white", 10)])
    response = await patch(client, a, list_id, **{field: None})
    assert response.status_code == 200
    assert response.json()["name"] == "Front Runner"
    assert response.json()["position"] == 0
    assert response.json()["sparks"] == [spark("white", 10)]


async def test_an_empty_spark_list_clears_the_membership(
    client: Any, users: list[User]
):
    """`[]` is how you empty a list; omitting the key is not. That distinction
    is what the shape rests on — and emptying is not deleting, so the list
    itself survives."""
    a, _ = users
    list_id = await a_list(client, a, "Front Runner")
    await patch(client, a, list_id, sparks=[spark("white", 10)])
    response = await patch(client, a, list_id, sparks=[])
    assert response.json()["sparks"] == []
    assert [row["name"] for row in await listing(client, a)] == ["Front Runner"]


async def test_a_mis_keyed_body_is_refused(client: Any, users: list[User]):
    """The one thing making every field optional could have cost: without
    `extra="forbid"` a typo parses as all-absent, so the route answers 200
    having written nothing and the user's failed save looks like a saved one.
    """
    a, _ = users
    list_id = await a_list(client, a, "Front Runner")
    async with client(a) as http:
        response = await http.patch(f"{LISTS}/{list_id}", json={"title": "Front"})
    assert response.status_code == 422
    assert [row["name"] for row in await listing(client, a)] == ["Front Runner"]


async def test_renaming_onto_an_existing_name_is_refused(
    client: Any, users: list[User]
):
    a, _ = users
    await a_list(client, a, "Front Runner")
    second = await a_list(client, a, "Medium")
    assert (await patch(client, a, second, name="Front Runner")).status_code == 409
    assert [row["name"] for row in await listing(client, a)] == [
        "Front Runner",
        "Medium",
    ]


async def test_renaming_a_list_to_its_own_name_is_fine(client: Any, users: list[User]):
    """The constraint is on the pair, so a no-op rename must not collide with
    the row making the change."""
    a, _ = users
    list_id = await a_list(client, a, "Front Runner")
    assert (await patch(client, a, list_id, name="Front Runner")).status_code == 200


async def test_patching_a_missing_list_is_a_404(client: Any, users: list[User]):
    """Unlike DELETE, "make this list hold these sparks" is not satisfied by
    the list not existing — a client told it succeeded would show membership
    nothing stored."""
    a, _ = users
    assert (await patch(client, a, 987_654, sparks=[])).status_code == 404


# ---------- the list cap ----------

async def test_too_many_lists_are_refused(client: Any, users: list[User]):
    a, _ = users
    for n in range(50):
        assert (await create(client, a, f"build {n}")).status_code == 201
    response = await create(client, a, "one more")
    assert response.status_code == 409
    assert len(await listing(client, a)) == 50
    # The cap and the name collision are BOTH 409s and the client shows
    # whichever detail it is handed, so they have to be distinguishable — a
    # user at the cap being told to pick another name renames four times and
    # learns nothing.
    assert "50 lists" in response.json()["detail"]


async def test_concurrent_creates_cannot_exceed_the_cap(
    client: Any, users: list[User]
):
    """The check-then-act the advisory lock exists for.

    At 49 lists, five simultaneous creates must yield exactly one 201 and
    four 409s. Without the lock all five could read 49, all five pass the
    test, and the owner would land on 54.

    **This asserts the OUTCOME and is NOT the guard. Measured: it still
    passes with `pg_advisory_xact_lock` removed.** An earlier version of this
    docstring explained that away by saying the test client drives these
    through one connection — which is FALSE: `conftest`'s override opens a
    new `AsyncSession` per request off a pooled engine, so they do interleave
    on separate connections.

    So the measurement stands and the reason for it is unknown, which means
    the lock's behaviour under real concurrency is unverified in either
    direction. Do not read a pass here as evidence the lock is present —
    deleting it would not fail this suite. Filed as #76, along with what a
    test that actually guards it would need.
    """
    a, _ = users
    for n in range(49):
        assert (await create(client, a, f"build {n}")).status_code == 201
    async with client(a) as http:
        responses = await asyncio.gather(
            *(http.post(LISTS, json={"name": f"race {n}"}) for n in range(5))
        )
    codes = sorted(r.status_code for r in responses)
    assert codes == [201, 409, 409, 409, 409], codes
    assert len(await listing(client, a)) == 50


async def test_the_cap_is_per_owner(client: Any, users: list[User]):
    """The one rule in this module that had no cross-owner pair, which meant
    dropping the `owner_id` filter from the count query would have passed the
    whole suite while blocking user b behind user a's 50 — the class of
    omission test_isolation.py exists to catch."""
    a, b = users
    for n in range(50):
        assert (await create(client, a, f"build {n}")).status_code == 201
    assert (await create(client, a, "one more")).status_code == 409
    assert (await create(client, b, "my first")).status_code == 201


async def test_a_bad_position_is_refused_rather_than_500ing(
    client: Any, users: list[User]
):
    """`position` lands in a Postgres int4, so an unbounded int turns a 422
    into a NumericValueOutOfRange 500 on commit. schemas.py is the authority
    on what the server accepts, so it has to say no first."""
    a, _ = users
    list_id = await a_list(client, a)
    assert (await patch(client, a, list_id, position=3_000_000_000)).status_code == 422
    assert (await patch(client, a, list_id, position=-1)).status_code == 422
    assert (await patch(client, a, list_id, position=7)).status_code == 200


# ---------- delete ----------

async def test_deleting_removes_the_list_and_its_membership(
    client: Any, users: list[User]
):
    """Membership is a column on the list, so there is nothing left behind to
    sweep — the whole argument for this shape over the two that keep
    membership on the spark (DECISIONS.md #37)."""
    a, _ = users
    list_id = await a_list(client, a)
    await patch(client, a, list_id, sparks=[spark("white", 10)])
    async with client(a) as http:
        assert (await http.delete(f"{LISTS}/{list_id}")).status_code == 204
    assert await listing(client, a) == []


async def test_deleting_something_gone_is_not_an_error(client: Any, users: list[User]):
    """Already gone is the outcome the caller wanted."""
    a, _ = users
    async with client(a) as http:
        assert (await http.delete(f"{LISTS}/12345")).status_code == 204


async def test_deleting_one_list_leaves_the_others(client: Any, users: list[User]):
    a, _ = users
    first = await a_list(client, a, "Front Runner")
    await a_list(client, a, "Medium")
    async with client(a) as http:
        await http.delete(f"{LISTS}/{first}")
    assert [row["name"] for row in await listing(client, a)] == ["Medium"]


# ---------- ownership ----------

async def test_lists_are_per_user(client: Any, users: list[User]):
    a, b = users
    await a_list(client, a, "Front Runner")
    assert await listing(client, b) == []


async def test_two_users_may_have_a_list_of_the_same_name(
    client: Any, users: list[User]
):
    """Uniqueness is per owner — "Front Runner" is a name half the playerbase
    would pick."""
    a, b = users
    await a_list(client, a, "Front Runner")
    assert (await create(client, b, "Front Runner")).status_code == 201


async def test_you_cannot_read_another_users_list(client: Any, users: list[User]):
    a, b = users
    await a_list(client, a, "Front Runner")
    assert await listing(client, b) == []


async def test_you_cannot_patch_another_users_list(client: Any, users: list[User]):
    """404 rather than 403: a wrong id and someone else's id give the same
    answer, so the route cannot be used to probe for rows that exist."""
    a, b = users
    list_id = await a_list(client, a, "Front Runner")
    assert (await patch(client, b, list_id, name="Mine Now")).status_code == 404
    assert [row["name"] for row in await listing(client, a)] == ["Front Runner"]


async def test_you_cannot_delete_another_users_list(client: Any, users: list[User]):
    a, b = users
    list_id = await a_list(client, a, "Front Runner")
    async with client(b) as http:
        assert (await http.delete(f"{LISTS}/{list_id}")).status_code == 204
    assert len(await listing(client, a)) == 1
