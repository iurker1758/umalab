"""One user cannot see or destroy another's rows (DECISIONS.md #32).

The rest of the suite is pure-module because the routers only pass models
through. These checks are the exception: what they assert IS the database
behaviour — an owner filter that's missing from one query, or a uniqueness
rule left global, is invisible at every other layer and only shows up as one
user's roster vanishing when another imports.

Needs a real Postgres, and the fixtures that provide it live in conftest.py
— shared with test_watched_sparks.py, which asserts the same ownership rule
over a different table.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
import pytest

from app.models import User

FIXTURE = Path(__file__).parent / "fixtures" / "roster.json"


def dump_bytes() -> bytes:
    """The shared fixture dump, a top-level array of veterans.

    Handed to both users unchanged on purpose: two players CAN hold the same
    trained_chara_id, and that is precisely what the old global unique
    constraint made impossible.
    """
    data: list[dict[str, Any]] = json.loads(FIXTURE.read_text(encoding="utf-8"))
    return json.dumps(data).encode()


async def import_as(as_user: Any, user: User, body: bytes | None = None) -> httpx.Response:
    async with as_user(user) as http:
        return await http.post(
            "/api/imports",
            files={"file": ("data.json", body or dump_bytes(), "application/json")},
        )


async def veterans_of(as_user: Any, user: User) -> list[dict[str, Any]]:
    async with as_user(user) as http:
        response = await http.get("/api/veterans")
    assert response.status_code == 200
    return response.json()


# ---------- imports ----------

async def test_an_import_does_not_touch_another_users_roster(client: Any, users: list[User]):
    """The bug that made this milestone urgent: `delete(Veteran)` was
    unqualified, so whoever imported last had the only roster."""
    a, b = users
    assert (await import_as(client, a)).status_code == 201
    before = await veterans_of(client, a)
    assert before, "fixture produced no veterans — the test proves nothing"

    assert (await import_as(client, b)).status_code == 201

    after = await veterans_of(client, a)
    assert [v["trained_chara_id"] for v in after] == [
        v["trained_chara_id"] for v in before
    ]


async def test_two_users_may_hold_the_same_trained_chara_id(client: Any, users: list[User]):
    """The uniqueness rule had to widen, not just the queries: the same dump
    imported by both users collides on every id under a global constraint."""
    a, b = users
    assert (await import_as(client, a)).status_code == 201
    assert (await import_as(client, b)).status_code == 201
    assert [v["trained_chara_id"] for v in await veterans_of(client, a)] == [
        v["trained_chara_id"] for v in await veterans_of(client, b)
    ]


async def test_the_veteran_list_shows_only_your_own(client: Any, users: list[User]):
    a, b = users
    assert (await import_as(client, a)).status_code == 201
    assert await veterans_of(client, b) == []


async def test_latest_import_is_your_own(client: Any, users: list[User]):
    a, b = users
    assert (await import_as(client, a)).status_code == 201
    async with client(b) as http:
        assert (await http.get("/api/imports/latest")).json() is None


# ---------- tags ----------

async def test_you_cannot_tag_another_users_veteran(client: Any, users: list[User]):
    a, b = users
    assert (await import_as(client, a)).status_code == 201
    victim = (await veterans_of(client, a))[0]["trained_chara_id"]

    async with client(b) as http:
        response = await http.post(
            f"/api/veterans/{victim}/tags", json={"tag": "mark_01"}
        )
    assert response.status_code == 404

    assert (await veterans_of(client, a))[0]["tags"] == []


async def test_a_bulk_tag_covering_another_users_veterans_is_refused(
    client: Any, users: list[User]
):
    a, b = users
    assert (await import_as(client, a)).status_code == 201
    ids = [v["trained_chara_id"] for v in await veterans_of(client, a)]

    async with client(b) as http:
        response = await http.post(
            "/api/veterans/tags/bulk",
            json={"trained_chara_ids": ids, "tag": "mark_02"},
        )
    assert response.status_code == 404


async def test_marks_are_not_shared_between_users(client: Any, users: list[User]):
    """Same veteran id on both rosters, tagged by one of them."""
    a, b = users
    assert (await import_as(client, a)).status_code == 201
    assert (await import_as(client, b)).status_code == 201
    shared_id = (await veterans_of(client, a))[0]["trained_chara_id"]

    async with client(a) as http:
        assert (
            await http.post(f"/api/veterans/{shared_id}/tags", json={"tag": "mark_03"})
        ).status_code == 201

    a_rows = {v["trained_chara_id"]: v["tags"] for v in await veterans_of(client, a)}
    b_rows = {v["trained_chara_id"]: v["tags"] for v in await veterans_of(client, b)}
    assert a_rows[shared_id] == ["mark_03"]
    assert b_rows[shared_id] == []


# ---------- blueprints ----------

BLUEPRINT = {
    "name": "mine",
    "slots": {"named": [None] * 7, "sparks": [None] * 24},
}


async def create_blueprint(as_user: Any, user: User) -> int:
    async with as_user(user) as http:
        response = await http.post("/api/blueprints", json=BLUEPRINT)
    assert response.status_code == 201, response.text
    return int(response.json()["id"])


async def test_blueprint_lists_are_separate(client: Any, users: list[User]):
    a, b = users
    await create_blueprint(client, a)
    async with client(b) as http:
        assert (await http.get("/api/blueprints")).json() == []


@pytest.mark.parametrize("method", ["get", "put", "delete"])
async def test_another_users_blueprint_is_a_404_not_a_403(
    client: Any, users: list[User], method: str
):
    """404, deliberately: a 403 would confirm the id exists, which is a row
    count the caller didn't have."""
    a, b = users
    blueprint_id = await create_blueprint(client, a)
    async with client(b) as http:
        if method == "get":
            # No single-blueprint GET route; the list is the read surface, so
            # the write verbs are what must refuse.
            response = await http.get("/api/blueprints")
            assert response.json() == []
            return
        request = http.put if method == "put" else http.delete
        response = await request(
            f"/api/blueprints/{blueprint_id}",
            **({"json": BLUEPRINT} if method == "put" else {}),
        )
    assert response.status_code == 404

    async with client(a) as http:
        assert [row["id"] for row in (await http.get("/api/blueprints")).json()] == [
            blueprint_id
        ]
