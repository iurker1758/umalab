"""The user's spark lists (DECISIONS.md #37, issue #39).

Database-backed for the same reason test_isolation.py is: what these assert
is the table — the curated order, per-owner name uniqueness, and that nothing
here filters against the factor reference. Fixtures come from conftest.py, so
the skip/PYTEST_REQUIRE_DB rules apply identically.

These replace test_watched_sparks.py wholesale. #33's shape had a `hunting`
bit and a derived group vocabulary; #37 holds why the axis was wrong and what
each of its rulings became. Membership is rows in `spark_list_members` with
per-member verbs (DECISIONS.md #48, issue #66) — the whole-array PATCH these
originally drove is the shape the 422s below pin as gone.
"""
from __future__ import annotations

import asyncio
from typing import Any

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from app.models import User
from app.schemas import MAX_LISTS_PER_OWNER

LISTS = "/api/spark-lists"

# How many simultaneous requests the concurrency tests race — and therefore
# how many pooled connections their warm-up must establish first. Must stay
# at or below conftest's engine default pool_size (5): a surplus request
# waits on a NEW connection, and connection establishment staggers the field
# back into the accidental serialization measured in #76.
CONCURRENT_WRITES = 5


async def create(as_user: Any, user: User, name: str):
    async with as_user(user) as http:
        return await http.post(LISTS, json={"name": name})


async def patch(as_user: Any, user: User, list_id: int, **body: Any):
    async with as_user(user) as http:
        return await http.patch(f"{LISTS}/{list_id}", json=body)


async def add(as_user: Any, user: User, list_id: int, kind: str, key: int):
    async with as_user(user) as http:
        return await http.put(f"{LISTS}/{list_id}/sparks/{kind}/{key}")


async def remove(as_user: Any, user: User, list_id: int, kind: str, key: int):
    async with as_user(user) as http:
        return await http.delete(f"{LISTS}/{list_id}/sparks/{kind}/{key}")


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
    assert body["updated_at"]
    assert body["sparks"] == []
    assert await listing(client, a) == [body]


async def test_a_list_is_created_empty_and_stays(client: Any, users: list[User]):
    """The state #33's derived group vocabulary could not represent at all: a
    named list with nothing in it. The picker's `New List` creates one and the
    membership write that fills it is a separate request, so this has to
    survive a read.
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


# ---------- order and edit times ----------

async def test_lists_read_back_in_creation_order(client: Any, users: list[User]):
    """`id` order — total and stable, so a list never jumps between reads.
    The management page re-sorts client-side (DECISIONS.md #44)."""
    a, _ = users
    for name in ("Front Runner", "Medium", "Long"):
        await a_list(client, a, name)
    assert [row["name"] for row in await listing(client, a)] == [
        "Front Runner",
        "Medium",
        "Long",
    ]


async def test_position_is_refused_like_any_unknown_field(
    client: Any, users: list[User]
):
    """The column shipped and was stripped before any UI set one (DECISIONS.md
    #44). `extra="forbid"` makes a straggling client's reorder a loud 422
    rather than a 200 that silently wrote nothing."""
    a, _ = users
    list_id = await a_list(client, a)
    assert (await patch(client, a, list_id, position=3)).status_code == 422
    assert "position" not in (await listing(client, a))[0]


async def test_an_edit_bumps_updated_at(client: Any, users: list[User]):
    """What the management page's "Last Edited" sort reads: a rename and both
    membership verbs count as edits. The bump is explicit in the routes —
    member writes never touch the list row, so the model's `onupdate` alone
    would leave this sort frozen at creation time."""
    a, _ = users
    list_id = await a_list(client, a)
    born = (await listing(client, a))[0]["updated_at"]
    renamed = (await patch(client, a, list_id, name="Medium")).json()["updated_at"]
    assert renamed > born
    filled = (await add(client, a, list_id, "white", 10)).json()["updated_at"]
    assert filled > renamed
    emptied = (await remove(client, a, list_id, "white", 10)).json()["updated_at"]
    assert emptied > filled


async def test_a_no_op_membership_write_does_not_bump_updated_at(
    client: Any, users: list[User]
):
    """The idempotent verbs answer 200 either way, but "already what you
    asked for" is not an edit — a bump here would float the list to the top
    of Last Edited for writes that changed nothing."""
    a, _ = users
    list_id = await a_list(client, a)
    filled = (await add(client, a, list_id, "white", 10)).json()["updated_at"]
    repeat = (await add(client, a, list_id, "white", 10)).json()["updated_at"]
    assert repeat == filled
    absent = (await remove(client, a, list_id, "white", 20)).json()["updated_at"]
    assert absent == filled


# ---------- membership ----------

async def test_adding_sparks(client: Any, users: list[User]):
    a, _ = users
    list_id = await a_list(client, a)
    assert (await add(client, a, list_id, "white", 2010)).status_code == 200
    response = await add(client, a, list_id, "race", 40)
    assert response.status_code == 200, response.text
    assert response.json()["sparks"] == [spark("white", 2010), spark("race", 40)]


async def test_membership_keeps_the_order_it_was_added_in(
    client: Any, users: list[User]
):
    """Member-id order IS the list's order — what the picker appends to and
    what the list renders, the role the old array's order carried."""
    a, _ = users
    list_id = await a_list(client, a)
    for key in (30, 10, 20):
        await add(client, a, list_id, "white", key)
    assert (await listing(client, a))[0]["sparks"] == [
        spark("white", 30),
        spark("white", 10),
        spark("white", 20),
    ]


async def test_the_same_key_under_a_different_kind_is_a_different_spark(
    client: Any, users: list[User]
):
    """Identity is (kind, key), not key — the kinds' id ranges are an ingest
    heuristic rather than a guarantee, so the unique triple must not collapse
    these."""
    a, _ = users
    list_id = await a_list(client, a)
    await add(client, a, list_id, "white", 1)
    response = await add(client, a, list_id, "race", 1)
    assert response.json()["sparks"] == [spark("white", 1), spark("race", 1)]


async def test_a_repeated_add_keeps_one_row_in_its_place(
    client: Any, users: list[User]
):
    """"Already in it" is the state the caller asked for, so a repeat is a
    200 rather than a 422 — and the member keeps its original position, so a
    mis-tap cannot shuffle the list."""
    a, _ = users
    list_id = await a_list(client, a)
    await add(client, a, list_id, "white", 10)
    await add(client, a, list_id, "white", 20)
    response = await add(client, a, list_id, "white", 10)
    assert response.status_code == 200
    assert response.json()["sparks"] == [spark("white", 10), spark("white", 20)]


async def test_a_removed_and_re_added_spark_moves_to_the_end(
    client: Any, users: list[User]
):
    """A fresh row gets a fresh id — the same place the old client-side
    filter-and-append landed it."""
    a, _ = users
    list_id = await a_list(client, a)
    await add(client, a, list_id, "white", 10)
    await add(client, a, list_id, "white", 20)
    await remove(client, a, list_id, "white", 10)
    response = await add(client, a, list_id, "white", 10)
    assert response.json()["sparks"] == [spark("white", 20), spark("white", 10)]


async def test_removing_a_spark(client: Any, users: list[User]):
    a, _ = users
    list_id = await a_list(client, a)
    await add(client, a, list_id, "white", 10)
    await add(client, a, list_id, "white", 20)
    response = await remove(client, a, list_id, "white", 10)
    assert response.status_code == 200
    assert response.json()["sparks"] == [spark("white", 20)]


async def test_removing_an_absent_spark_is_not_an_error(
    client: Any, users: list[User]
):
    """Idempotent like the add: already absent is the state the path named."""
    a, _ = users
    list_id = await a_list(client, a)
    await add(client, a, list_id, "white", 10)
    response = await remove(client, a, list_id, "white", 999)
    assert response.status_code == 200
    assert response.json()["sparks"] == [spark("white", 10)]


async def test_membership_writes_to_a_missing_list_are_404s(
    client: Any, users: list[User]
):
    """Unlike removing an absent MEMBER: "put this spark in that list" is not
    satisfied by the list not existing. The 404 names the whole list, which
    is what lets a stale client drop a deleted list's pill in place instead
    of retrying a dead write forever (issue #66's absorbed #73)."""
    a, _ = users
    async with client(a) as http:
        assert (await http.put(f"{LISTS}/987654/sparks/white/10")).status_code == 404
        assert (
            await http.delete(f"{LISTS}/987654/sparks/white/10")
        ).status_code == 404


async def test_concurrent_adds_to_one_list_all_land(
    client: Any, users: list[User]
):
    """THE defect issue #66 was filed on, at the shape that closes it: five
    simultaneous adds of different sparks must all survive. Under the
    whole-array PATCH each writer rewrote the list from its own copy, so the
    last commit won and four sparks vanished behind five 200s; single-row
    inserts commute, so there is no longer a version of events where one add
    overwrites another.

    Warmed pool per DECISIONS.md #38 — on a cold pool, connection
    establishment staggers the field into running one at a time, and a
    serialized run would pass even against the old shape."""
    a, _ = users
    list_id = await a_list(client, a)
    async with client(a) as http:
        await asyncio.gather(*(http.get(LISTS) for _ in range(CONCURRENT_WRITES)))
        responses = await asyncio.gather(
            *(
                http.put(f"{LISTS}/{list_id}/sparks/white/{10 * (n + 1)}")
                for n in range(CONCURRENT_WRITES)
            )
        )
    assert [r.status_code for r in responses] == [200] * CONCURRENT_WRITES
    held = {(s["kind"], s["key"]) for s in (await listing(client, a))[0]["sparks"]}
    assert held == {("white", 10 * (n + 1)) for n in range(CONCURRENT_WRITES)}


async def test_a_kind_outside_the_set_is_unrepresentable(
    client: Any, users: list[User], sessions: Any
):
    """What retired the loud-read tradeoff (issue #66's absorbed #75): the
    JSONB column could hold an entry the strict read model refused, and one
    such entry 500'd the owner's every list. Member rows carry a CHECK
    mirroring ListSparkKind, so the bad entry is refused at the write — the
    read can never meet one, and stays strict for free."""
    a, _ = users
    list_id = await a_list(client, a)
    smuggled = text(
        "INSERT INTO spark_list_members (list_id, kind, key)"
        " VALUES (:i, 'pink', 70)"
    ).bindparams(i=list_id)
    async with sessions() as session:
        with pytest.raises(IntegrityError, match="ck_spark_list_member_kind"):
            await session.execute(smuggled)
    assert (await listing(client, a))[0]["sparks"] == []


async def test_an_unknown_key_is_accepted(client: Any, users: list[User]):
    """No validation against the factor reference, matching blueprint factors:
    app/data is regenerated by hand and can run behind a dump, and a spark
    missing from it is still a legitimate thing to want."""
    a, _ = users
    list_id = await a_list(client, a)
    response = await add(client, a, list_id, "white", 999_999)
    assert response.status_code == 200
    assert response.json()["sparks"] == [spark("white", 999_999)]


async def test_an_unknown_kind_is_refused(client: Any, users: list[User]):
    """`kind` decides the proc base rate, so unlike `key` it is closed — now
    by the path segment's Literal, before any handler runs. The pink stays
    outside it — it has its own editor, never a list."""
    a, _ = users
    list_id = await a_list(client, a)
    assert (await add(client, a, list_id, "pink", 1)).status_code == 422


async def test_blues_and_greens_are_not_listable(client: Any, users: list[User]):
    """Both are slot kinds a list still refuses: a list is a hunt, and every
    parent carries her blue and her own green regardless (DECISIONS.md #40)."""
    a, _ = users
    list_id = await a_list(client, a)
    assert (await add(client, a, list_id, "blue", 1)).status_code == 422
    assert (await add(client, a, list_id, "unique", 100101)).status_code == 422


@pytest.mark.parametrize("key", [0, 2_147_483_648])
async def test_a_key_outside_int4_is_refused(
    client: Any, users: list[User], key: int
):
    """The same bound SparkRef puts on the old body shape: an oversized key
    is unrepresentable everywhere else the app puts a factor id."""
    a, _ = users
    list_id = await a_list(client, a)
    assert (await add(client, a, list_id, "white", key)).status_code == 422


@pytest.mark.parametrize(
    "sparks", [None, [], [{"kind": "white", "key": 10}]]
)
async def test_a_whole_array_patch_is_refused(
    client: Any, users: list[User], sparks: Any
):
    """The pre-#48 write shape. `extra="forbid"` turns a stale client's
    whole-array PATCH into a loud 422 rather than a 200 that would silently
    drop every edit that landed since that client last read."""
    a, _ = users
    list_id = await a_list(client, a)
    await add(client, a, list_id, "white", 30)
    assert (await patch(client, a, list_id, sparks=sparks)).status_code == 422
    assert (await listing(client, a))[0]["sparks"] == [spark("white", 30)]


# ---------- partial updates ----------
# The one thing about #33's request shape that carried over intact: an omitted
# field is left alone, and null means the same as absent.


async def test_adding_a_spark_leaves_the_name(client: Any, users: list[User]):
    a, _ = users
    list_id = await a_list(client, a, "Front Runner")
    response = await add(client, a, list_id, "white", 10)
    assert response.json()["name"] == "Front Runner"


async def test_renaming_leaves_the_membership(client: Any, users: list[User]):
    """A rename is one row and one field — the whole reason lists are their
    own table rather than a name repeated across every spark that holds it."""
    a, _ = users
    list_id = await a_list(client, a, "Front Runner")
    await add(client, a, list_id, "white", 10)
    response = await patch(client, a, list_id, name="Front")
    assert response.json()["name"] == "Front"
    assert response.json()["sparks"] == [spark("white", 10)]


async def test_an_empty_patch_changes_nothing(client: Any, users: list[User]):
    a, _ = users
    list_id = await a_list(client, a, "Front Runner")
    await add(client, a, list_id, "white", 10)
    response = await patch(client, a, list_id)
    assert response.status_code == 200
    assert response.json()["name"] == "Front Runner"
    assert response.json()["sparks"] == [spark("white", 10)]


async def test_an_explicit_null_leaves_the_name_alone(
    client: Any, users: list[User]
):
    """Absent and null mean the same thing, so a client serializing an unset
    field as null gets the same answer as one omitting it."""
    a, _ = users
    list_id = await a_list(client, a, "Front Runner")
    response = await patch(client, a, list_id, name=None)
    assert response.status_code == 200
    assert response.json()["name"] == "Front Runner"


async def test_removing_the_last_spark_keeps_the_list(
    client: Any, users: list[User]
):
    """Emptying is not deleting — an empty list is a normal state, the same
    one it was created in."""
    a, _ = users
    list_id = await a_list(client, a, "Front Runner")
    await add(client, a, list_id, "white", 10)
    response = await remove(client, a, list_id, "white", 10)
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
    """Unlike DELETE, "rename this list" is not satisfied by the list not
    existing — a client told it succeeded would show a name nothing stored."""
    a, _ = users
    assert (await patch(client, a, 987_654, name="Medium")).status_code == 404


# ---------- the list cap ----------

async def test_too_many_lists_are_refused(client: Any, users: list[User]):
    a, _ = users
    for n in range(MAX_LISTS_PER_OWNER):
        assert (await create(client, a, f"build {n}")).status_code == 201
    response = await create(client, a, "one more")
    assert response.status_code == 409
    assert len(await listing(client, a)) == MAX_LISTS_PER_OWNER
    # The cap and the name collision are BOTH 409s and the client shows
    # whichever detail it is handed, so they have to be distinguishable — a
    # user at the cap being told to pick another name renames four times and
    # learns nothing.
    assert f"{MAX_LISTS_PER_OWNER} lists" in response.json()["detail"]


async def test_concurrent_creates_cannot_exceed_the_cap(
    client: Any, users: list[User], sessions: Any
):
    """The check-then-act the advisory lock exists for: at 49 lists, five
    simultaneous creates must yield exactly one 201 and four 409s, never an
    owner at 54.

    The pool is warmed first, and that is load-bearing. On a cold pool each
    gathered request waits on a NEW connection, and connection establishment
    staggers them into running one at a time — measured: with the lock
    removed, the cold-pool version still passed [201, 409, 409, 409, 409]
    while the warmed version landed [201, 201, 201, 201, 201], three runs
    out of three each way. Genuine interleaving still isn't guaranteed, so
    the lock itself is pinned deterministically by
    `test_the_cap_check_runs_under_the_advisory_lock` below.
    """
    a, _ = users
    # Fixture state, not behaviour under test — the create path up to the
    # cap is `test_too_many_lists_are_refused`'s, so the 49 rows arrive as
    # one INSERT rather than 49 request cycles.
    async with sessions() as session:
        await session.execute(
            text(
                "INSERT INTO spark_lists (owner_id, name)"
                " SELECT :o, 'build ' || n"
                " FROM generate_series(1, :n) n"
            ).bindparams(o=a.id, n=MAX_LISTS_PER_OWNER - 1)
        )
        await session.commit()
    async with client(a) as http:
        await asyncio.gather(
            *(http.get(LISTS) for _ in range(CONCURRENT_WRITES))
        )
        responses = await asyncio.gather(
            *(
                http.post(LISTS, json={"name": f"race {n}"})
                for n in range(CONCURRENT_WRITES)
            )
        )
    codes = sorted(r.status_code for r in responses)
    assert codes == [201] + [409] * (CONCURRENT_WRITES - 1), codes
    assert len(await listing(client, a)) == MAX_LISTS_PER_OWNER


async def test_the_cap_check_runs_under_the_advisory_lock(
    client: Any, users: list[User], sessions: Any
):
    """The deterministic guard on the lock, where the race above could still
    accidentally serialize.

    A second transaction holds the owner's advisory lock while a create is
    fired. The create must turn up in pg_locks as a WAITER ON THAT LOCK —
    a positive sighting, not "still running after a timeout", which a slow
    connect or a loaded runner produces too. Then the holder fills the
    owner to the cap and releases: a create that counts under the lock
    finds a full owner and answers the cap 409. So this fails if the lock
    is deleted — the create finishes instead of waiting — AND if it slides
    below the count it protects: the create counted an empty table, so it
    inserts one list past the cap on release. Both measured, three runs
    of three.
    """
    a, _ = users
    async with client(a) as http, sessions() as holder:
        await holder.execute(select(func.pg_advisory_xact_lock(a.id)))
        request = asyncio.ensure_future(
            http.post(LISTS, json={"name": "Front Runner"})
        )
        try:
            # pg_advisory_xact_lock(bigint) files under classid = the
            # key's high 32 bits (0 for any real user id), objid = the
            # low 32, objsubid 1. Scoped to this database: advisory keys
            # are per-database, but pg_locks lists every backend on the
            # instance, and owner 1 exists in every copy of this app — a
            # dev server's waiter must not satisfy the sighting.
            waiting = text(
                "SELECT count(*) FROM pg_locks"
                " WHERE locktype = 'advisory' AND classid = 0"
                " AND objid = :oid AND objsubid = 1 AND NOT granted"
                " AND database = (SELECT oid FROM pg_database"
                " WHERE datname = current_database())"
            ).bindparams(oid=a.id)
            for _ in range(100):
                if request.done():
                    # Retrieved, so a POST that raised reports its own
                    # traceback rather than a missing lock.
                    pytest.fail(
                        "the create finished instead of waiting: "
                        f"{request.exception() or request.result()!r}"
                    )
                if await holder.scalar(waiting):
                    break
                await asyncio.sleep(0.05)
            else:
                pytest.fail("the create never waited on the owner lock")
            await holder.execute(
                text(
                    "INSERT INTO spark_lists (owner_id, name)"
                    " SELECT :o, 'bulk ' || n"
                    " FROM generate_series(1, :cap) n"
                ).bindparams(o=a.id, cap=MAX_LISTS_PER_OWNER)
            )
            # Commit ends the holder's transaction, which IS the
            # release — the lock is transaction-scoped. Only now may
            # the create proceed, and what it must find is a full
            # owner.
            await holder.commit()
            response = await asyncio.wait_for(request, timeout=5)
        finally:
            # Release the lock BEFORE reaping: a failure above leaves the
            # create parked on it, and awaiting a task nothing will unblock
            # is a hang, not a report. A no-op on the success path, where
            # commit already ended the transaction. The reap itself keeps a
            # POST that raised from dying as teardown noise under "Task
            # exception was never retrieved".
            await holder.rollback()
            request.cancel()
            await asyncio.gather(request, return_exceptions=True)
    assert response.status_code == 409, response.text
    assert f"{MAX_LISTS_PER_OWNER} lists" in response.json()["detail"]
    assert len(await listing(client, a)) == MAX_LISTS_PER_OWNER


async def test_the_cap_is_per_owner(client: Any, users: list[User]):
    """The one rule in this module that had no cross-owner pair, which meant
    dropping the `owner_id` filter from the count query would have passed the
    whole suite while blocking user b behind user a's 50 — the class of
    omission test_isolation.py exists to catch."""
    a, b = users
    for n in range(MAX_LISTS_PER_OWNER):
        assert (await create(client, a, f"build {n}")).status_code == 201
    assert (await create(client, a, "one more")).status_code == 409
    assert (await create(client, b, "my first")).status_code == 201


# ---------- delete ----------

async def test_deleting_removes_the_list_and_its_membership(
    client: Any, users: list[User], sessions: Any
):
    """The member table's FK cascades at the database, so nothing is left
    behind to sweep — the property #37 chose membership-on-the-list for,
    kept by #48's move to rows."""
    a, _ = users
    list_id = await a_list(client, a)
    await add(client, a, list_id, "white", 10)
    async with client(a) as http:
        assert (await http.delete(f"{LISTS}/{list_id}")).status_code == 204
    assert await listing(client, a) == []
    async with sessions() as session:
        stranded = await session.scalar(
            text("SELECT count(*) FROM spark_list_members WHERE list_id = :i")
            .bindparams(i=list_id)
        )
    assert stranded == 0


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


async def test_you_cannot_edit_membership_of_another_users_list(
    client: Any, users: list[User]
):
    """The member verbs answer for `_owned` the same way the PATCH does."""
    a, b = users
    list_id = await a_list(client, a, "Front Runner")
    await add(client, a, list_id, "white", 10)
    assert (await add(client, b, list_id, "white", 20)).status_code == 404
    assert (await remove(client, b, list_id, "white", 10)).status_code == 404
    assert (await listing(client, a))[0]["sparks"] == [spark("white", 10)]


async def test_you_cannot_delete_another_users_list(client: Any, users: list[User]):
    a, b = users
    list_id = await a_list(client, a, "Front Runner")
    async with client(b) as http:
        assert (await http.delete(f"{LISTS}/{list_id}")).status_code == 204
    assert len(await listing(client, a)) == 1
