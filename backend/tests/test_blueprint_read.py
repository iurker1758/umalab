"""One unparseable stored row must not take down the whole blueprint list
(issue #92, DECISIONS.md #51).

Needs a real Postgres like test_isolation.py — the malformed row is written
straight into the table, below the validated POST path, which is exactly how
such a row would exist in production.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import Blueprint, User

GOOD_SLOTS = {"named": [None] * 7, "sparks": [None] * 24}
# Wrong-length arrays: the strict model rejects this (the document is
# positional), so it can only be read back raw.
BAD_SLOTS = {"named": [None] * 3, "sparks": []}


async def test_a_malformed_row_reads_raw_beside_the_good_ones(
    client: Any, users: list[User], sessions: async_sessionmaker[AsyncSession]
):
    owner = users[0]
    async with client(owner) as http:
        response = await http.post(
            "/api/blueprints", json={"name": "good", "slots": GOOD_SLOTS}
        )
        assert response.status_code == 201, response.text

    async with sessions() as session:
        session.add(Blueprint(owner_id=owner.id, name="bad", slots=BAD_SLOTS))
        await session.commit()

    async with client(owner) as http:
        response = await http.get("/api/blueprints")
    assert response.status_code == 200, response.text
    rows = {row["name"]: row["slots"] for row in response.json()}
    assert rows["good"] == GOOD_SLOTS
    # Verbatim, not repaired or dropped: the client's own parse is the gate,
    # and it refuses to open just this row.
    assert rows["bad"] == BAD_SLOTS
