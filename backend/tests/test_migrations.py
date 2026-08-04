"""The migration chain and models.py describe the same schema (issue #76).

Everything else in the DB-backed suite runs against a schema built by
`Base.metadata.create_all`, so a migration that drifts from the models — a
renamed index, a changed expression, a dropped line — leaves production
missing something the whole suite still exercises. The concrete instance
that prompted this: `uq_spark_list_owner_lower_name` exists as raw SQL in
migration c5e3a91f7d20 and as a hand-mirrored `text()` Index in models.py,
and only the models copy was ever tested.

One test closes the class rather than the instance: run the real
`alembic upgrade head` against the test database, then ask alembic's own
autogenerate comparison whether anything differs from `Base.metadata`.
Measured against that index: deleting the migration's `op.execute` line
fails this as `add_index`, and changing its expression to plain `name`
fails as `remove_index` + `add_index` — the comparison sees expressions,
not just index names.
Building the whole suite's schema through migrations instead would close it
too, but that rework stays deferred — this is the cheap version.

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
from sqlalchemy.exc import InterfaceError, OperationalError
from sqlalchemy.ext.asyncio import create_async_engine

from app.database import Base
from tests.conftest import REQUIRE_DB, TEST_DATABASE_URL

BACKEND_DIR = Path(__file__).resolve().parent.parent


def _drift(connection: Connection) -> list[object]:
    return list(
        compare_metadata(MigrationContext.configure(connection), Base.metadata)
    )


async def test_upgrade_head_matches_the_models():
    engine = create_async_engine(TEST_DATABASE_URL)
    try:
        try:
            async with engine.begin() as connection:
                # Whole schema, for conftest's reason: a leftover table from
                # another branch would fail a targeted drop on its foreign
                # keys. This also removes alembic_version, so the upgrade
                # below always runs the full chain from the initial revision.
                await connection.exec_driver_sql("DROP SCHEMA public CASCADE")
                await connection.exec_driver_sql("CREATE SCHEMA public")
        except (OperationalError, InterfaceError, OSError) as e:
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
            diff = await connection.run_sync(_drift)
        # Each entry is one divergence, rendered by alembic in the terms
        # autogenerate would use to repair it ("add_index", "remove_column").
        # Fix it by making the migration and the model agree — not by
        # regenerating the schema from whichever side happens to be right.
        assert diff == [], f"migrations and models.py disagree: {diff}"
    finally:
        await engine.dispose()
