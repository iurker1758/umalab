"""Blueprint document v2 validation (the tree rules over the named
triangle), a save/read round-trip at the schema layer, and the catalog's
per-card aptitude shape. Pure-module tests like the rest of the suite —
no DB, no HTTP; the routers only pass these models through.

Tree indexing (DECISIONS.md #25): 31 nodes breadth-first, node i's kids at
2i+1 / 2i+2. `named` covers indices 0-6, `sparks` indices 7-30.
"""
import datetime as dt
from collections.abc import Mapping
from typing import Any

import pytest
from pydantic import ValidationError

from app.ingest import derive_chara_id
from app.reference import APTITUDES
from app.routers.designer import CATALOG
from app.schemas import (
    NAMED_SLOT_COUNT,
    SPARK_SLOT_COUNT,
    BlueprintIn,
    BlueprintOut,
    PinkSparkIn,
)

# ---------- document fixtures ----------


def slot(chara_id: int, **overrides: Any) -> dict[str, Any]:
    """A catalog slot whose card matches the chara (card_id // 100 rule)."""
    return {
        "source": "catalog",
        "chara_id": chara_id,
        "card_id": chara_id * 100 + 1,
        **overrides,
    }


def pink(aptitude: str = "mile", stars: int = 3) -> dict[str, Any]:
    return {"aptitude": aptitude, "stars": stars}


def doc(
    named: Mapping[int, dict[str, Any] | None] | None = None,
    sparks: Mapping[int, dict[str, Any] | None] | None = None,
    **overrides: Any,
) -> dict[str, Any]:
    """A valid document body with slots placed by tree index (named use
    absolute indices 0-6; sparks absolute indices 7-30)."""
    named_list: list[dict[str, Any] | None] = [None] * NAMED_SLOT_COUNT
    for index, value in (named or {}).items():
        named_list[index] = value
    sparks_list: list[dict[str, Any] | None] = [None] * SPARK_SLOT_COUNT
    for index, value in (sparks or {}).items():
        sparks_list[index - NAMED_SLOT_COUNT] = value
    return {
        "name": "test design",
        "slots": {"named": named_list, "sparks": sparks_list},
        **overrides,
    }


FULL_TRIANGLE = {
    0: slot(1001),
    1: slot(1002, spark=pink()),
    2: slot(1003, spark=pink("turf", 1)),
    3: slot(1004, spark=pink("long", 2)),
    4: slot(1005),
    5: slot(1006),
    6: slot(1007),
}


# ---------- legal configurations ----------


def test_empty_document_is_legal() -> None:
    assert BlueprintIn.model_validate(doc()).name == "test design"


def test_full_distinct_triangle_is_legal() -> None:
    BlueprintIn.model_validate(doc(named=FULL_TRIANGLE))


def test_partial_with_gaps_is_legal() -> None:
    # A grandparent under an EMPTY parent: rules apply between filled slots
    # only, and the designer allows building the tree in any order.
    BlueprintIn.model_validate(doc(named={0: slot(1001), 3: slot(1001)}))


def test_grandparent_repeating_trainee_is_legal() -> None:
    # The game allows it (affinity scores the triple 0 but keeps wins).
    BlueprintIn.model_validate(
        doc(named={0: slot(1001), 1: slot(1002), 3: slot(1001)})
    )


def test_cross_family_repeat_is_legal() -> None:
    # p2's chara reappearing as a grandparent on p1's side is game-legal.
    BlueprintIn.model_validate(
        doc(named={0: slot(1001), 1: slot(1002), 2: slot(1003), 4: slot(1003)})
    )


def test_spark_slots_accept_pinks() -> None:
    body = BlueprintIn.model_validate(
        doc(sparks={7: pink(), 30: pink("end", 1)})
    )
    assert body.slots.sparks[0] == PinkSparkIn(aptitude="mile", stars=3)
    assert body.slots.sparks[23] == PinkSparkIn(aptitude="end", stars=1)


# ---------- tree rules ----------


def _rejects(body: dict[str, Any], fragment: str) -> None:
    with pytest.raises(ValidationError, match=fragment):
        BlueprintIn.model_validate(body)


def test_parent_repeating_trainee_rejected() -> None:
    _rejects(
        doc(named={0: slot(1001), 2: slot(1001)}),
        "a parent can't be the trainee's own character",
    )


def test_duplicate_parents_rejected() -> None:
    _rejects(
        doc(named={1: slot(1002), 2: slot(1002)}),
        "the two parents must be different characters",
    )


def test_grandparent_repeating_own_parent_rejected() -> None:
    # Both families: node 3 under parent 1, node 6 under parent 2.
    _rejects(
        doc(named={1: slot(1002), 3: slot(1002)}),
        "a grandparent can't repeat its own parent's character",
    )
    _rejects(
        doc(named={2: slot(1003), 6: slot(1003)}),
        "a grandparent can't repeat its own parent's character",
    )


def test_duplicate_sibling_grandparents_rejected() -> None:
    _rejects(
        doc(named={5: slot(1004), 6: slot(1004)}),
        "a parent's two grandparents must be different",
    )


def test_trainee_spark_rejected() -> None:
    # Nothing is bred from the trainee — its slot never carries a pink.
    _rejects(
        doc(named={0: slot(1001, spark=pink())}),
        "the trainee slot can't carry a spark",
    )


# ---------- field validation ----------


def test_unknown_aptitude_key_rejected() -> None:
    with pytest.raises(ValidationError):
        BlueprintIn.model_validate(doc(sparks={7: pink("speed")}))


@pytest.mark.parametrize("stars", [0, 4])
def test_star_range_enforced(stars: int) -> None:
    with pytest.raises(ValidationError):
        BlueprintIn.model_validate(doc(sparks={7: pink(stars=stars)}))


@pytest.mark.parametrize(("named_len", "sparks_len"), [(6, 24), (8, 24), (7, 23), (7, 25)])
def test_exact_array_lengths_enforced(named_len: int, sparks_len: int) -> None:
    # Positional document: a short array would silently shift every slot
    # below the gap, so wrong lengths must 422 instead.
    with pytest.raises(ValidationError):
        BlueprintIn.model_validate(
            {
                "name": "n",
                "slots": {"named": [None] * named_len, "sparks": [None] * sparks_len},
            }
        )


def test_card_chara_mismatch_rejected() -> None:
    _rejects(
        doc(named={0: slot(1001, card_id=100201)}),
        "does not belong to chara",
    )


def test_roster_slot_needs_trained_chara_id() -> None:
    _rejects(
        doc(named={1: slot(1002, source="roster")}),
        "needs a trained_chara_id",
    )


def test_blank_name_rejected() -> None:
    _rejects(doc(name="   "), "name must not be blank")


# ---------- round-trip through the persisted document ----------


def test_v2_document_round_trips_through_blueprint_out() -> None:
    # What the router does: BlueprintIn.slots.model_dump() into JSONB, then
    # BlueprintOut re-validates the stored dict on the way out. Every typed
    # spark and slot position must survive unchanged.
    body = BlueprintIn.model_validate(
        doc(named=FULL_TRIANGLE, sparks={7: pink(), 18: pink("dirt", 2)})
    )
    now = dt.datetime(2026, 7, 31, 12, 0, 0, tzinfo=dt.UTC)
    out = BlueprintOut.model_validate(
        {
            "id": 1,
            "name": body.name,
            "slots": body.slots.model_dump(),
            "created_at": now,
            "updated_at": now,
        }
    )
    assert out.slots == body.slots
    named1 = out.slots.named[1]
    assert named1 is not None
    assert named1.spark == PinkSparkIn(aptitude="mile", stars=3)
    assert out.slots.sparks[11] == PinkSparkIn(aptitude="dirt", stars=2)


# ---------- catalog shape (real committed data) ----------


def test_catalog_cards_are_sorted_with_base_first() -> None:
    for entry in CATALOG:
        card_ids = [card.card_id for card in entry.cards]
        assert card_ids == sorted(card_ids)
        # 7-digit NPC copies (9100101) fold into their real chara's entry.
        assert all(derive_chara_id(card_id) == entry.chara_id for card_id in card_ids)
    # The base outfit (lowest card id) is the icon source — Special Week's
    # entry must lead with her base card.
    special_week = next(entry for entry in CATALOG if entry.chara_id == 1001)
    assert special_week.cards[0].card_id == 100101


def test_catalog_aptitudes_null_only_for_npc_cards() -> None:
    # The two uma.moe NPC/tutorial cards (91xxxxx) have no card_rarity_data
    # rows — they surface as "letters unknown", everything else is lettered.
    for entry in CATALOG:
        for card in entry.cards:
            if card.card_id in APTITUDES:
                assert card.aptitudes is not None
            else:
                assert card.card_id // 1_00000 == 91
                assert card.aptitudes is None


def test_catalog_shows_per_card_aptitude_difference() -> None:
    # Haru Urara's New Year outfit runs Mile A against her base card's B —
    # the reason the catalog carries aptitudes per CARD, not per chara.
    haru = next(entry for entry in CATALOG if entry.chara_id == 1052)
    by_card = {card.card_id: card.aptitudes for card in haru.cards}
    base, alt = by_card[105201], by_card[105202]
    assert base is not None
    assert alt is not None
    assert base["mile"] == "B"
    assert alt["mile"] == "A"
