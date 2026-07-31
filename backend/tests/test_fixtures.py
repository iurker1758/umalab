"""Guards on the committed e2e roster fixture.

`tests/fixtures/roster.json` is a synthetic UmaExtractor dump — never a real
one — that CI imports before the end-to-end suite so the designer's roster
pull has something to pull (BACKLOG e2e phase 2). It is data, not code, so
these tests are what documents and defends its shape: they fail in the
backend job, loudly, rather than letting the e2e job fail hours later with an
opaque selector timeout.

Two classes of breakage they catch:

* a reference-data regen dropping a card the fixture names, which would make
  every pulled chip render as "Card 100101" with no aptitude letters;
* an edit that makes a veteran's lineage game-illegal, which would make the
  pull it feeds save-time-422 instead of filling the tree.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, get_args

from app import reference
from app.ingest import derive_chara_id, parse_dump
from app.schemas import AptitudeKey

FIXTURE = Path(__file__).parent / "fixtures" / "roster.json"

# app/data/factors.json, type 1 — the pink (aptitude) factor keys. Mirrored in
# the frontend's PINK_KEY_APTITUDE (blueprint.ts); a pull reads the spark off
# these, so the fixture has to carry them.
PINK_KEYS = {
    11: "turf", 12: "dirt",
    31: "sprint", 32: "mile", 33: "medium", 34: "long",
    21: "front", 22: "pace", 23: "late", 24: "end",
}

RAW: list[dict[str, Any]] = json.loads(FIXTURE.read_text(encoding="utf-8"))
PARSED = parse_dump(RAW, reference.CARDS, reference.FACTORS)


def test_fixture_parses_as_a_dump() -> None:
    # The import route runs exactly this; anything it rejects would 400 in CI
    # with the seeding step's curl reporting only a status code.
    assert len(PARSED) == len(RAW) == 8


def test_every_card_resolves_with_aptitude_letters() -> None:
    # Names come from cards.json and the designer's base letters from
    # aptitudes.json. A fixture card missing from either still imports, but
    # the e2e assertions about what a chip says would be checking a
    # placeholder.
    for veteran in PARSED:
        cards = [veteran["card_id"]] + [m["card_id"] for m in veteran["lineage"]]
        for card_id in cards:
            assert card_id in reference.CARDS, f"card {card_id} not in cards.json"
            assert card_id in reference.APTITUDES, f"card {card_id} not in aptitudes.json"
            # The catalog filters 7-digit NPC copies out, so a fixture that
            # named one could never be matched against a catalog chip.
            assert card_id <= 999_999


def test_every_veteran_has_a_full_six_slot_lineage() -> None:
    # The pull fills two generations from one fetch: 10/20 become the tree's
    # grandparents and 11/12/21/22 its generation-3 sparks. A short lineage
    # would leave nodes untouched and quietly weaken the suite.
    for veteran in PARSED:
        positions = sorted(m["position_id"] for m in veteran["lineage"])
        assert positions == [10, 11, 12, 20, 21, 22]


def test_every_member_carries_exactly_one_pink() -> None:
    # The spark is what a pulled node contributes to the bracket math above
    # it, so a member without one contributes nothing and the auto-fill
    # assertions would pass vacuously.
    for veteran in PARSED:
        for record in [veteran, *veteran["lineage"]]:
            pinks = [f for f in record["factors"] if f["kind"] == "pink"]
            assert len(pinks) == 1, (record["card_id"], pinks)
            assert pinks[0]["key"] in PINK_KEYS
            assert 1 <= pinks[0]["star"] <= 3


def test_pink_keys_cover_every_aptitude() -> None:
    # The frontend maps these ids to AptitudeKey; a reference regen that
    # renamed or renumbered a pink would break the pull silently, since an
    # unmapped key just reads as "no pink".
    assert set(PINK_KEYS.values()) == set(get_args(AptitudeKey))
    for key, name in PINK_KEYS.items():
        info = reference.FACTORS.get(key)
        assert info is not None, (key, name)
        assert info["type"] == 1, (key, name)


def test_every_lineage_is_a_legal_blueprint_triangle() -> None:
    # Pulling a veteran writes it and its two succession parents into three
    # tree nodes at once. The game's rules apply between them, so a fixture
    # veteran sharing a chara with one of its own parents would produce a
    # pull the server rejects — an e2e failure with no obvious cause.
    for veteran in PARSED:
        parents = [m for m in veteran["lineage"] if m["position_id"] in (10, 20)]
        charas = [veteran["chara_id"]] + [m["chara_id"] for m in parents]
        assert len(set(charas)) == 3, (veteran["trained_chara_id"], charas)
        assert all(derive_chara_id(m["card_id"]) == m["chara_id"] for m in veteran["lineage"])


def test_the_cast_is_varied_enough_to_pick_from() -> None:
    # The e2e suite picks veterans by predicate against /api/veterans rather
    # than by hardcoded id, so it needs genuine variety to choose from: two
    # veterans that differ in chara (a legal parent pair) and a spread of
    # pinks to assert distinct auto-filled sparks against.
    assert len({v["chara_id"] for v in PARSED}) >= 4
    pinks = {
        (f["key"], f["star"])
        for v in PARSED
        for m in v["lineage"]
        for f in m["factors"]
        if f["kind"] == "pink"
    }
    assert len(pinks) >= 8


def test_won_saddles_survive_into_the_snapshot() -> None:
    # Roster and lineage slots carry win_saddle_ids so a veteran that leaves
    # the roster keeps its win bonus when re-scored. Empty is legitimate —
    # the fixture has both so neither path goes untested.
    wins = [m["win_saddles"] for v in PARSED for m in v["lineage"]]
    assert any(w for w in wins)
    assert any(not w for w in wins)
