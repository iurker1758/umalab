"""The migration chain and models.py describe the same schema (issue #76).

The DB-backed suite builds its schema from `Base.metadata.create_all`, so
it asserts against the MODELS: a migration that drifts — a renamed index,
a changed expression, a dropped server default — leaves production missing
something every test still exercises. The instance that prompted this:
`uq_spark_list_owner_lower_name` is raw SQL in migration c5e3a91f7d20,
hand-mirrored as a `text()` Index in models.py.

CI's "Migrations match the models" step (`alembic upgrade head` +
`alembic check`) enforces the same invariant, but merges don't wait for CI
here, so the local run is the gate that counts — and this test also
compares server defaults, which `alembic check` leaves off. Building the
whole suite's schema through migrations would close the class more
thoroughly; that rework stays deferred — this is the cheap version.

Measured, one mutation at a time: deleting the migration's index line
fails as `add_index`; changing its expression to plain `name` fails as
`remove_index` + `add_index`; deleting `position`'s server default fails
as `modify_default`.

The upgrade runs in a subprocess because `app.config.settings` is a
module-level singleton: in-process, alembic/env.py would read the app's own
DATABASE_URL, and this test must never touch that database. A subprocess
re-imports settings fresh with DATABASE_URL overridden — and exercises the
exact command a deployment runs, not a test-only harness around it.

Same skip/PYTEST_REQUIRE_DB rules as conftest.py.
"""
from __future__ import annotations

import asyncio
import os
import subprocess
import sys
from pathlib import Path

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import Connection
from sqlalchemy.ext.asyncio import create_async_engine

# Registers the tables on Base.metadata — the comparison below is empty
# without it, and reaching them through conftest's transitive imports would
# break the moment a fixture refactor drops one. env.py carries the same
# import for the same reason.
from app import models  # noqa: F401  # pyright: ignore[reportUnusedImport]
from app.database import Base
from tests.conftest import (
    DB_UNREACHABLE,
    REQUIRE_DB,
    TEST_DATABASE_URL,
    reset_public_schema,
)

BACKEND_DIR = Path(__file__).resolve().parent.parent


def _drift(connection: Connection) -> list[object]:
    # compare_server_default is OFF by default in alembic (and in CI's
    # `alembic check`), which would let a migration drop a hand-mirrored
    # default — spark_lists.sparks, veterans.win_saddles — while this test
    # stays green. models.py declares seven; all compare clean.
    return list(
        compare_metadata(
            MigrationContext.configure(
                connection, opts={"compare_server_default": True}
            ),
            Base.metadata,
        )
    )


async def test_upgrade_head_matches_the_models():
    engine = create_async_engine(TEST_DATABASE_URL)
    try:
        try:
            async with engine.begin() as connection:
                # Also removes alembic_version, so the upgrade below always
                # runs the full chain from the initial revision.
                await reset_public_schema(connection)
        except DB_UNREACHABLE as e:
            if REQUIRE_DB:
                raise
            pytest.skip(f"no test database at {TEST_DATABASE_URL}: {e}")

        result = await asyncio.to_thread(
            subprocess.run,
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=BACKEND_DIR,
            env={**os.environ, "DATABASE_URL": TEST_DATABASE_URL},
            capture_output=True,
            text=True,
            timeout=120,
        )
        assert result.returncode == 0, result.stderr

        async with engine.connect() as connection:
            # The child's only tie to this database is DATABASE_URL
            # outranking backend/.env inside its fresh settings import —
            # conftest's same-database refusal cannot see a subprocess. If
            # that link ever breaks, the upgrade lands on the app's own
            # database and the diff below degenerates into add_table noise;
            # the missing stamp names the actual fault.
            stamped = (
                await connection.exec_driver_sql(
                    "SELECT to_regclass('public.alembic_version')"
                )
            ).scalar()
            assert (
                stamped is not None
            ), f"the upgrade did not run against {TEST_DATABASE_URL}"
            diff = await connection.run_sync(_drift)
        # Each entry is one divergence, rendered by alembic in the terms
        # autogenerate would use to repair it ("add_index", "remove_column").
        # Fix it by making the migration and the model agree — not by
        # regenerating the schema from whichever side happens to be right.
        assert diff == [], f"migrations and models.py disagree: {diff}"
    finally:
        await engine.dispose()
