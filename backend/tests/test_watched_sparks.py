"""The watched-spark list (DECISIONS.md #33, issue #39).

Database-backed for the same reason test_isolation.py is: what these assert
is the table — insertion order, per-owner uniqueness, and that nothing here
filters against the factor reference. Fixtures come from conftest.py, so the
skip/PYTEST_REQUIRE_DB rules apply identically.
"""
from __future__ import annotations

import asyncio
from typing import Any

import pytest

from app.models import User
from app.routers import sparks as sparks_router

WATCHED = "/api/watched-sparks"


async def put(as_user: Any, user: User, kind: str, key: int, **body: Any):
    async with as_user(user) as http:
        return await http.put(
            f"{WATCHED}/{kind}/{key}", json={"hunting": True, "groups": [], **body}
        )


async def listing(as_user: Any, user: User) -> list[dict[str, Any]]:
    async with as_user(user) as http:
        response = await http.get(WATCHED)
    assert response.status_code == 200
    return response.json()


def without_id(row: dict[str, Any]) -> dict[str, Any]:
    """`id` is a real part of the payload — it carries the list position —
    but it is a database sequence, so the value-shaped assertions drop it."""
    return {k: v for k, v in row.items() if k != "id"}


# ---------- the row ----------

async def test_a_watched_spark_round_trips(client: Any, users: list[User]):
    a, _ = users
    response = await put(client, a, "white", 2010, groups=["Front Runner"])
    assert response.status_code == 200
    assert without_id(response.json()) == {
        "kind": "white",
        "key": 2010,
        "hunting": True,
        "groups": ["Front Runner"],
    }
    assert response.json()["id"] > 0
    assert await listing(client, a) == [response.json()]


# ---------- partial updates (issue #64) ----------
# These reverse the original "a partial body is refused" rule, which was right
# for a full-replace route and wrong about which half to fix (DECISIONS.md #33's
# amendment). What they pin is the distinction the shape rests on: absent and
# null leave a field, `groups: []` clears it.


async def test_an_empty_body_creates_a_hunted_ungrouped_row(
    client: Any, users: list[User]
):
    """"Make sure this spark is watched" is a complete request. It is what the
    client's `toggle` means, and it can now say it without first finding out
    whether the row exists."""
    a, _ = users
    async with client(a) as http:
        response = await http.put(f"{WATCHED}/race/40", json={})
    assert response.status_code == 200
    assert without_id(response.json()) == {
        "kind": "race",
        "key": 40,
        "hunting": True,
        "groups": [],
    }


async def test_an_empty_body_leaves_an_existing_row_exactly_as_it_was(
    client: Any, users: list[User]
):
    """Issue #62, closed at the route: the request that used to arrive as
    "replace this with the defaults" now cannot overwrite anything."""
    a, _ = users
    await put(client, a, "white", 2010, hunting=False, groups=["Mile", "Front"])
    async with client(a) as http:
        response = await http.put(f"{WATCHED}/white/2010", json={})
    assert response.status_code == 200
    assert without_id(response.json()) == {
        "kind": "white",
        "key": 2010,
        "hunting": False,
        "groups": ["Mile", "Front"],
    }


async def test_setting_the_bit_leaves_the_groups(client: Any, users: list[User]):
    a, _ = users
    await put(client, a, "white", 2010, hunting=True, groups=["Front Runner"])
    async with client(a) as http:
        response = await http.put(f"{WATCHED}/white/2010", json={"hunting": False})
    assert response.json()["hunting"] is False
    assert response.json()["groups"] == ["Front Runner"]


async def test_setting_the_groups_leaves_the_bit(client: Any, users: list[User]):
    a, _ = users
    await put(client, a, "white", 2010, hunting=False, groups=[])
    async with client(a) as http:
        response = await http.put(f"{WATCHED}/white/2010", json={"groups": ["Medium"]})
    assert response.json()["groups"] == ["Medium"]
    assert response.json()["hunting"] is False


@pytest.mark.parametrize("field", ["hunting", "groups"])
async def test_an_explicit_null_leaves_the_field_alone(
    client: Any, users: list[User], field: str
):
    """Absent and null mean the same thing, so a client serializing an
    unset field as null gets the same answer as one omitting it."""
    a, _ = users
    await put(client, a, "white", 2010, hunting=False, groups=["Mile"])
    async with client(a) as http:
        response = await http.put(f"{WATCHED}/white/2010", json={field: None})
    assert response.json()["hunting"] is False
    assert response.json()["groups"] == ["Mile"]


async def test_an_empty_group_list_clears_them(client: Any, users: list[User]):
    """`[]` is how you clear; omitting the key is not. That distinction is the
    whole of what the shape rests on."""
    a, _ = users
    await put(client, a, "white", 2010, groups=["Mile"])
    async with client(a) as http:
        response = await http.put(f"{WATCHED}/white/2010", json={"groups": []})
    assert response.json()["groups"] == []


async def test_a_mis_keyed_body_is_refused(client: Any, users: list[User]):
    """The one thing making both fields optional could have cost: without
    `extra="forbid"` a typo parses as all-absent, so the route answers 200
    having written nothing and the user's failed save looks like a saved one.
    """
    a, _ = users
    await put(client, a, "white", 2010, hunting=True, groups=["Mile"])
    async with client(a) as http:
        response = await http.put(f"{WATCHED}/white/2010", json={"hunted": False})
    assert response.status_code == 422
    assert [without_id(row) for row in await listing(client, a)] == [
        {"kind": "white", "key": 2010, "hunting": True, "groups": ["Mile"]}
    ]


async def test_an_unknown_key_is_accepted(client: Any, users: list[User]):
    """No validation against the factor reference, matching blueprint
    factors: app/data is regenerated by hand and can run behind a dump, and
    a spark missing from it is still a legitimate thing to want."""
    a, _ = users
    assert (await put(client, a, "white", 999_999)).status_code == 200
    assert [s["key"] for s in await listing(client, a)] == [999_999]


async def test_an_unknown_kind_is_refused(client: Any, users: list[User]):
    """`kind` decides the proc base rate, so unlike `key` it is closed."""
    a, _ = users
    assert (await put(client, a, "blue", 1)).status_code == 422


# ---------- one row per (kind, key) ----------

async def test_re_putting_replaces_rather_than_duplicating(client: Any, users: list[User]):
    a, _ = users
    await put(client, a, "white", 2010, hunting=True, groups=["Front Runner"])
    await put(client, a, "white", 2010, hunting=False, groups=["Medium"])
    assert [without_id(row) for row in await listing(client, a)] == [
        {"kind": "white", "key": 2010, "hunting": False, "groups": ["Medium"]}
    ]


async def test_the_same_key_under_a_different_kind_is_a_different_spark(
    client: Any, users: list[User]
):
    """Uniqueness is (kind, key), not key — the kinds' id ranges are an
    ingest heuristic rather than a guarantee."""
    a, _ = users
    await put(client, a, "white", 1)
    await put(client, a, "race", 1)
    assert [(s["kind"], s["key"]) for s in await listing(client, a)] == [
        ("white", 1),
        ("race", 1),
    ]


async def test_a_re_put_keeps_its_place_in_the_list(client: Any, users: list[User]):
    """Order is what the chooser shows, so re-hunting an old spark must not
    move it to the end."""
    a, _ = users
    for key in (1, 2, 3):
        await put(client, a, "white", key)
    first = (await listing(client, a))[0]["id"]
    again = await put(client, a, "white", 1, hunting=False)
    assert [s["key"] for s in await listing(client, a)] == [1, 2, 3]
    # Same row, not a delete-and-recreate: the id is what the client sorts by.
    assert again.json()["id"] == first


async def test_insertion_order_is_preserved(client: Any, users: list[User]):
    a, _ = users
    for key in (30, 10, 20):
        await put(client, a, "white", key)
    assert [s["key"] for s in await listing(client, a)] == [30, 10, 20]


# ---------- groups ----------

async def test_a_spark_may_belong_to_two_builds(client: Any, users: list[User]):
    """The reason this is one list with labels rather than several lists:
    separate lists could only express this by duplicating the row."""
    a, _ = users
    response = await put(client, a, "white", 2010, groups=["Front Runner", "Medium"])
    assert response.json()["groups"] == ["Front Runner", "Medium"]


async def test_group_names_are_trimmed_and_deduped(client: Any, users: list[User]):
    a, _ = users
    response = await put(
        client, a, "white", 2010, groups=["  Front Runner ", "Front Runner"]
    )
    assert response.json()["groups"] == ["Front Runner"]


@pytest.mark.parametrize("groups", [[""], ["   "], ["x" * 41]])
async def test_unusable_group_names_are_refused(
    client: Any, users: list[User], groups: list[str]
):
    a, _ = users
    assert (await put(client, a, "white", 1, groups=groups)).status_code == 422


async def test_the_group_cap_applies_after_dedupe(client: Any, users: list[User]):
    """A `max_length` on the field would run BEFORE the dedupe validator, so
    a payload repeating one name 30 times would 422 on its raw length even
    though it collapses to one group."""
    a, _ = users
    response = await put(client, a, "white", 1, groups=["Front Runner"] * 30)
    assert response.status_code == 200
    assert response.json()["groups"] == ["Front Runner"]


async def test_too_many_distinct_groups_are_still_refused(
    client: Any, users: list[User]
):
    a, _ = users
    groups = [f"build {n}" for n in range(21)]
    assert (await put(client, a, "white", 1, groups=groups)).status_code == 422


# ---------- the upsert race ----------

async def test_concurrent_puts_for_one_spark_settle_on_a_single_row(
    client: Any, users: list[User]
):
    """A double-clicked watch control, or a chooser click and a hunting
    toggle in the same tick. The route reads then inserts, so two requests
    can both find nothing and both try to insert.

    This asserts the OUTCOME, and it is not the guard — measured against a
    version with the conflict handling removed, it still passed, because the
    interleaving is up to the scheduler and did not happen to collide. The
    test below forces the collision; keep both.
    """
    a, _ = users
    async with client(a) as http:
        responses = await asyncio.gather(
            *(
                http.put(
                    f"{WATCHED}/white/2010", json={"hunting": True, "groups": []}
                )
                for _ in range(5)
            )
        )
    assert [r.status_code for r in responses] == [200] * 5
    assert len(await listing(client, a)) == 1


async def test_the_upsert_recovers_when_it_loses_the_insert_race(
    client: Any, users: list[User], monkeypatch: pytest.MonkeyPatch
):
    """The recovery path itself, deterministically.

    Concurrency alone can't guarantee the interleaving, so this forces it:
    the row exists, but the route's first lookup reports it doesn't — which
    is exactly what the losing request sees. The insert then violates
    uq_watched_spark_owner_kind_key, and what follows is the code under
    test. Without the rollback-and-retry this is a 500.
    """
    a, _ = users
    await put(client, a, "white", 2010, hunting=True, groups=["Front Runner"])

    real_row = sparks_router._row  # pyright: ignore[reportPrivateUsage]
    lookups = 0

    async def blind_once(*args: Any, **kwargs: Any) -> Any:
        nonlocal lookups
        lookups += 1
        if lookups == 1:
            return None
        return await real_row(*args, **kwargs)

    monkeypatch.setattr(sparks_router, "_row", blind_once)

    response = await put(client, a, "white", 2010, hunting=False, groups=["Medium"])

    assert response.status_code == 200, response.text
    assert lookups >= 2, "the retry never re-read the row"
    # One row, carrying what the losing request asked for.
    assert [without_id(row) for row in await listing(client, a)] == [
        {"kind": "white", "key": 2010, "hunting": False, "groups": ["Medium"]}
    ]


async def test_the_upsert_loses_the_insert_race_to_an_empty_body(
    client: Any, users: list[User], monkeypatch: pytest.MonkeyPatch
):
    """The same forced collision, with the body that will actually lose it.

    A double-clicked ★ fires two `{}` PUTs, so the empty body is the one most
    likely to reach the retry arm — and the one the arm's partial-apply is
    for. Assigning the body's fields unconditionally there (what this route
    did before #64) would put `None` in a NOT NULL column and 500, and the
    full-body test above would still pass.
    """
    a, _ = users
    await put(client, a, "white", 2010, hunting=False, groups=["Medium"])

    real_row = sparks_router._row  # pyright: ignore[reportPrivateUsage]
    lookups = 0

    async def blind_once(*args: Any, **kwargs: Any) -> Any:
        nonlocal lookups
        lookups += 1
        if lookups == 1:
            return None
        return await real_row(*args, **kwargs)

    monkeypatch.setattr(sparks_router, "_row", blind_once)

    async with client(a) as http:
        response = await http.put(f"{WATCHED}/white/2010", json={})

    assert response.status_code == 200, response.text
    assert lookups >= 2, "the retry never re-read the row"
    # The loser asked for nothing, so the row it found keeps everything.
    assert [without_id(row) for row in await listing(client, a)] == [
        {"kind": "white", "key": 2010, "hunting": False, "groups": ["Medium"]}
    ]


# ---------- delete ----------

async def test_unwatching_removes_the_row(client: Any, users: list[User]):
    a, _ = users
    await put(client, a, "white", 2010)
    async with client(a) as http:
        assert (await http.delete(f"{WATCHED}/white/2010")).status_code == 204
    assert await listing(client, a) == []


async def test_unwatching_something_unwatched_is_not_an_error(
    client: Any, users: list[User]
):
    """Already gone is the outcome the caller wanted."""
    a, _ = users
    async with client(a) as http:
        assert (await http.delete(f"{WATCHED}/white/12345")).status_code == 204


# ---------- ownership ----------

async def test_lists_are_per_user(client: Any, users: list[User]):
    a, b = users
    await put(client, a, "white", 2010)
    assert await listing(client, b) == []


async def test_two_users_may_watch_the_same_spark_differently(
    client: Any, users: list[User]
):
    a, b = users
    await put(client, a, "white", 2010, hunting=True, groups=["Front Runner"])
    await put(client, b, "white", 2010, hunting=False)
    assert (await listing(client, a))[0]["groups"] == ["Front Runner"]
    assert without_id((await listing(client, b))[0]) == {
        "kind": "white",
        "key": 2010,
        "hunting": False,
        "groups": [],
    }


async def test_you_cannot_unwatch_another_users_spark(client: Any, users: list[User]):
    a, b = users
    await put(client, a, "white", 2010)
    async with client(b) as http:
        assert (await http.delete(f"{WATCHED}/white/2010")).status_code == 204
    assert len(await listing(client, a)) == 1
