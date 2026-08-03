"""One user cannot see or destroy another's rows (DECISIONS.md #32).

The rest of the suite is pure-module because the routers only pass models
through. These checks are the exception: what they assert IS the database
behaviour — an owner filter that's missing from one query, or a uniqueness
rule left global, is invisible at every other layer and only shows up as one
user's roster vanishing when another imports.

Needs a real Postgres: the models use JSONB and the tag upserts use
Postgres' ON CONFLICT, so the aiosqlite path the rest of the suite could
have used isn't available here. Skipped when no test database is reachable;
set PYTEST_REQUIRE_DB=1 (CI does) to make that skip a failure instead, the
same way E2E_REQUIRE_ROSTER works for the Playwright suite.
"""
from __future__ import annotations

import json
import os
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Any

import httpx
import pytest
import pytest_asyncio
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.auth import current_user
from app.config import settings
from app.database import Base, get_session
from app.main import app
from app.models import User

FIXTURE = Path(__file__).parent / "fixtures" / "roster.json"

# Same server and credentials as the app, different database — derived rather
# than defaulted to a literal, so a developer whose Postgres isn't the
# password-less default doesn't have to configure the tests separately.
# TEST_DATABASE_URL overrides it outright.
# render_as_string(hide_password=False), not str(): SQLAlchemy's URL renders
# its password as *** by default, which reaches Postgres as a literal and
# fails authentication.
TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL") or make_url(
    settings.database_url
).set(database="umalab_test").render_as_string(hide_password=False)
REQUIRE_DB = os.environ.get("PYTEST_REQUIRE_DB") == "1"

# These tests drop and recreate every table. Pointing them at the URL the app
# itself uses would destroy a real roster, so that is refused outright rather
# than guarded by a naming convention.
if settings.database_url == TEST_DATABASE_URL:
    raise RuntimeError(
        "TEST_DATABASE_URL is the app's own DATABASE_URL — these tests drop "
        "every table. Point them at a separate database."
    )


@pytest_asyncio.fixture
async def sessions() -> AsyncGenerator[async_sessionmaker[AsyncSession], None]:
    """A fresh schema per test.

    Function-scoped rather than module-scoped so each test owns its own
    event loop — pytest-asyncio's default fixture loop scope here is
    "function", and a longer-lived engine would be bound to a loop that no
    longer exists. The schema is eight small tables; correctness per test is
    worth more than the second it costs across the module.
    """
    engine = create_async_engine(TEST_DATABASE_URL)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.drop_all)
            await connection.run_sync(Base.metadata.create_all)
    # Broad on purpose: any connect, auth or permission failure means "no
    # test database here", and which one it was doesn't change the outcome.
    except Exception as e:
        await engine.dispose()
        if REQUIRE_DB:
            raise
        pytest.skip(f"no test database at {TEST_DATABASE_URL}: {e}")
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest_asyncio.fixture
async def users(sessions: async_sessionmaker[AsyncSession]) -> list[User]:
    async with sessions() as session:
        rows = [User(email="a@example.com"), User(email="b@example.com")]
        session.add_all(rows)
        await session.commit()
        for row in rows:
            await session.refresh(row)
        return rows


@pytest.fixture
def client(sessions: async_sessionmaker[AsyncSession], users: list[User]):
    """A factory: `client(user)` makes a client that authenticates as `user`.

    `current_user` itself is overridden rather than driven with a token —
    what it produces from a request is test_auth.py's subject, and what the
    routes do with the result is this file's.
    """
    async def override_session() -> AsyncGenerator[AsyncSession, None]:
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_session] = override_session

    def as_user(user: User) -> httpx.AsyncClient:
        app.dependency_overrides[current_user] = lambda: user
        return httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        )

    yield as_user
    app.dependency_overrides.clear()


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
