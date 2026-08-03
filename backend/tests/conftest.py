"""Fixtures for the database-backed modules (test_isolation, test_watched_sparks).

Most of this suite is pure-module and touches none of these — fixtures are
lazy, so they cost those tests nothing. What needs them needs a real
Postgres: the models use JSONB and the tag upserts use ON CONFLICT, so
there is no aiosqlite path (DECISIONS.md #32).

Skipped when no test database is reachable; set PYTEST_REQUIRE_DB=1 (CI
does) to make that skip a failure instead, the same way E2E_REQUIRE_ROSTER
works for the Playwright suite. A security invariant that silently stops
running is worse than one that was never written.
"""
from __future__ import annotations

import os
from collections.abc import AsyncGenerator

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

# Same server and credentials as the app, different database — derived rather
# than defaulted to a literal, so a developer whose Postgres isn't the
# password-less default doesn't have to configure the tests separately.
# TEST_DATABASE_URL overrides it outright.
#
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
    longer exists. The schema is a handful of small tables; correctness per
    test is worth more than the second it costs across the module.
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
    routes do with the result is these modules'.
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
