"""Blueprint document v2 validation (the tree rules over the named
triangle), a save/read round-trip at the schema layer, and the catalog's
per-card aptitude shape. Pure-module tests like the rest of the suite —
no DB, no HTTP; the routers only pass these models through.

One exception: GET /api/factors is exercised over HTTP. It is the one route
that IS its own logic — a static list plus a response_model — so a broken
path, verb or serialization would otherwise pass every test here green and
only surface in the Playwright suite, which needs a running stack and does
not gate the backend job. It touches no database, so it costs nothing.

Tree indexing (DECISIONS.md #25): 31 nodes breadth-first, node i's kids at
2i+1 / 2i+2. `named` covers indices 0-6, `sparks` indices 7-30.
"""
import datetime as dt
from collections.abc import Mapping
from typing import Any, get_args

import pytest
from pydantic import ValidationError

from app.ingest import derive_chara_id
from app.reference import CardAptitudes
from app.routers.designer import CATALOG, PICKABLE_FACTORS
from app.schemas import (
    NAMED_SLOT_COUNT,
    SPARK_SLOT_COUNT,
    AptitudeKey,
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


def spark_only(aptitude: str = "mile", stars: int = 3) -> dict[str, Any]:
    """A named slot carrying a planned pink with nobody cast in it yet."""
    return {
        "source": "catalog",
        "chara_id": None,
        "card_id": None,
        "spark": pink(aptitude, stars),
    }


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


def out_of(body: BlueprintIn, stored: dict[str, Any] | None = None) -> BlueprintOut:
    """What the router does on read: the stored JSONB document — the body's
    own dump unless a test hands a mutated one — re-validated through
    BlueprintOut."""
    now = dt.datetime(2026, 7, 31, 12, 0, 0, tzinfo=dt.UTC)
    return BlueprintOut.model_validate(
        {
            "id": 1,
            "name": body.name,
            "slots": body.slots.model_dump() if stored is None else stored,
            "created_at": now,
            "updated_at": now,
        }
    )


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


def test_named_slot_may_carry_a_spark_without_a_character() -> None:
    # Planning usually starts from the pinks you're hunting, not from a cast.
    body = BlueprintIn.model_validate(doc(named={1: spark_only(), 3: spark_only("turf", 1)}))
    parent1 = body.slots.named[1]
    assert parent1 is not None
    assert parent1.chara_id is None
    assert parent1.card_id is None
    assert parent1.spark == PinkSparkIn(aptitude="mile", stars=3)


def test_spark_only_slots_sit_out_the_chara_rules() -> None:
    # No character named ⇒ nothing to collide with, in either rule family.
    BlueprintIn.model_validate(doc(named={1: spark_only(), 2: spark_only()}))
    BlueprintIn.model_validate(doc(named={1: spark_only(), 3: spark_only()}))


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


def deep(chara_id: int) -> dict[str, Any]:
    """A generation-3/4 slot naming a character, with no pink."""
    return {"card_id": chara_id * 100 + 1}


def test_deep_slot_repeating_the_slot_above_it_rejected() -> None:
    # The rules reach past the grandparents now that these slots can name a
    # character. Node 7 sits under node 3; node 15 sits under node 7.
    _rejects(
        doc(named={3: slot(1004)}, sparks={7: deep(1004)}),
        "can't repeat the character of the slot above it",
    )
    _rejects(
        doc(sparks={7: deep(1004), 15: deep(1004)}),
        "can't repeat the character of the slot above it",
    )


def test_deep_siblings_must_differ() -> None:
    _rejects(
        doc(sparks={7: deep(1004), 8: deep(1004)}),
        "two slots sharing a parent must be different characters",
    )
    _rejects(
        doc(sparks={29: deep(1004), 30: deep(1004)}),
        "two slots sharing a parent must be different characters",
    )


def test_deep_repeats_across_branches_are_legal() -> None:
    # Same rule as the named nodes: only the pairing and the direct line
    # matter. Nodes 7 and 9 sit under different parents, and node 15's
    # grandparent is node 3 — not its parent, so no rule applies.
    BlueprintIn.model_validate(doc(sparks={7: deep(1004), 9: deep(1004)}))
    BlueprintIn.model_validate(
        doc(named={3: slot(1004)}, sparks={7: deep(1005), 15: deep(1004)})
    )


def test_a_deep_slot_naming_nobody_collides_with_nothing() -> None:
    # A pink with no character sits out every chara rule, exactly as a
    # spark-only named slot does.
    BlueprintIn.model_validate(
        doc(named={3: slot(1004)}, sparks={7: pink(), 8: pink("turf", 1)})
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


def test_aptitude_key_matches_reference_card_aptitudes() -> None:
    # AptitudeKey (the API contract) and reference.CardAptitudes (the data
    # shape) are declared separately; a regen that renames a key must fail
    # here, not as save-time 422s. Order matters — it's the display order.
    assert list(get_args(AptitudeKey)) == list(CardAptitudes.__annotations__)


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


def test_identity_less_slot_without_a_spark_rejected() -> None:
    # An untouched node is written as a null slot, not as an empty husk.
    _rejects(
        doc(named={1: {"source": "catalog", "chara_id": None, "card_id": None}}),
        "must carry a spark",
    )


def test_half_an_identity_rejected() -> None:
    _rejects(
        doc(named={1: {"source": "catalog", "chara_id": 1002, "card_id": None,
                       "spark": pink()}}),
        "must be set together",
    )


def test_trainee_cannot_be_spark_only() -> None:
    # It would need a spark to be legal, and the trainee can't carry one.
    _rejects(doc(named={0: spark_only()}), "the trainee slot can't carry a spark")


def test_roster_slot_needs_a_character() -> None:
    _rejects(
        doc(named={1: {"source": "roster", "chara_id": None, "card_id": None,
                       "spark": pink(), "trained_chara_id": 5}}),
        "needs a character",
    )


def test_roster_slot_needs_trained_chara_id() -> None:
    _rejects(
        doc(named={1: slot(1002, source="roster")}),
        "needs a trained_chara_id",
    )


def test_lineage_slot_needs_a_position_id() -> None:
    _rejects(
        doc(named={3: slot(1004, source="lineage", trained_chara_id=5)}),
        "needs a position_id",
    )


def test_blank_name_rejected() -> None:
    _rejects(doc(name="   "), "name must not be blank")


# ---------- roster pulls (designer V2) ----------


def test_a_pulled_triangle_is_legal() -> None:
    # What the designer writes when a roster veteran is pulled into Parent 1:
    # the veteran itself at node 1, its two succession parents (position
    # 10/20) at nodes 3 and 4. A blueprint grandparent is the parent
    # veteran's PARENT — never its grandparent, which is the classic error.
    body = BlueprintIn.model_validate(
        doc(
            named={
                0: slot(1001),
                1: slot(1002, source="roster", trained_chara_id=900001, spark=pink(),
                        win_saddle_ids=[10, 63]),
                3: slot(1004, source="lineage", trained_chara_id=900001, position_id=10,
                        spark=pink("long", 2), win_saddle_ids=[63]),
                4: slot(1005, source="lineage", trained_chara_id=900001, position_id=20,
                        spark=pink("turf", 1), win_saddle_ids=[]),
            }
        )
    )
    parent1 = body.slots.named[1]
    grandparent = body.slots.named[3]
    assert parent1 is not None
    assert grandparent is not None
    # The wins ride in the snapshot: a veteran that later leaves the roster
    # must keep its win bonus when the blueprint is re-scored.
    assert parent1.win_saddle_ids == [10, 63]
    assert grandparent.position_id == 10
    assert grandparent.trained_chara_id == 900001


def test_gen3_spark_carries_optional_card_identity() -> None:
    # A roster pull knows who the generation-3 slots are (the picked
    # veteran's own grandparents, positions 11/12/21/22), so it stores the
    # card id rather than discarding it. JSONB column ⇒ no migration.
    body = BlueprintIn.model_validate(doc(sparks={7: {**pink(), "card_id": 100401}}))
    assert body.slots.sparks[0] == PinkSparkIn(aptitude="mile", stars=3, card_id=100401)


def test_deep_slot_may_name_a_character_with_no_pink() -> None:
    # The mirror of a named node holding a character before its pink is
    # decided — casting first is a normal way to plan.
    body = BlueprintIn.model_validate(doc(sparks={7: {"card_id": 100401}}))
    slot7 = body.slots.sparks[0]
    assert slot7 is not None
    assert slot7.card_id == 100401
    assert slot7.aptitude is None
    assert slot7.stars is None


@pytest.mark.parametrize("raw", [{"aptitude": "mile"}, {"stars": 2}])
def test_half_a_spark_rejected(raw: dict[str, Any]) -> None:
    # Half a spark would read as a different one downstream: a missing
    # aptitude silently contributes nothing, a missing star count reads as 0.
    _rejects(doc(sparks={7: raw}), "aptitude and stars must be set together")


def test_wholly_empty_deep_slot_rejected() -> None:
    # An untouched node is written as null, not as an empty husk — same rule
    # the named slots follow.
    _rejects(doc(sparks={7: {}}), "must carry a spark, a character, or both")


def test_named_slot_spark_must_be_a_real_pink() -> None:
    # PinkSparkIn doubles as the deep-slot model, where a bare character is
    # legal. A named node keeps identity in its own fields, so a face-only
    # value there is a shape the document doesn't have a meaning for.
    _rejects(
        doc(named={1: slot(1002, spark={"card_id": 100401})}),
        "a named slot's spark needs an aptitude",
    )


def test_spark_without_identity_still_parses() -> None:
    # Every hand-typed spark, and every row written before the pull existed.
    body = BlueprintIn.model_validate(doc(sparks={7: pink()}))
    assert body.slots.sparks[0] is not None
    assert body.slots.sparks[0].card_id is None


def test_pulled_document_round_trips_through_blueprint_out() -> None:
    # The identity must survive JSONB and re-validation, or a reload would
    # silently anonymize every pulled generation-3 slot.
    body = BlueprintIn.model_validate(
        doc(
            named={
                1: slot(1002, source="roster", trained_chara_id=900001, spark=pink(),
                        win_saddle_ids=[10]),
                3: slot(1004, source="lineage", trained_chara_id=900001, position_id=10),
            },
            sparks={7: {**pink("dirt", 2), "card_id": 100601}},
        )
    )
    out = out_of(body)
    assert out.slots == body.slots
    assert out.slots.sparks[0] == PinkSparkIn(aptitude="dirt", stars=2, card_id=100601)
    named3 = out.slots.named[3]
    assert named3 is not None
    assert named3.source == "lineage"
    assert named3.position_id == 10


# ---------- round-trip through the persisted document ----------


def test_v2_document_round_trips_through_blueprint_out() -> None:
    # What the router does: BlueprintIn.slots.model_dump() into JSONB, then
    # BlueprintOut re-validates the stored dict on the way out. Every typed
    # spark and slot position must survive unchanged.
    body = BlueprintIn.model_validate(
        doc(named=FULL_TRIANGLE, sparks={7: pink(), 18: pink("dirt", 2)})
    )
    out = out_of(body)
    assert out.slots == body.slots
    named1 = out.slots.named[1]
    assert named1 is not None
    assert named1.spark == PinkSparkIn(aptitude="mile", stars=3)
    assert out.slots.sparks[11] == PinkSparkIn(aptitude="dirt", stars=2)


# ---------- non-pink sparks (designer V2, inspiration procs) ----------


def white(key: int = 20035, stars: int = 2) -> dict[str, Any]:
    return {"kind": "white", "key": key, "stars": stars}


def test_named_slot_carries_sparks_of_every_pickable_kind() -> None:
    body = BlueprintIn.model_validate(
        doc(
            named={
                1: slot(
                    1002,
                    spark=pink(),
                    factors=[
                        white(),
                        {"kind": "unique", "key": 100201, "stars": 3},
                        {"kind": "race", "key": 10001, "stars": 1},
                        {"kind": "scenario", "key": 40001, "stars": 2},
                    ],
                )
            }
        )
    )
    named1 = body.slots.named[1]
    assert named1 is not None
    assert [(f.kind, f.stars) for f in named1.factors] == [
        ("white", 2), ("unique", 3), ("race", 1), ("scenario", 2),
    ]


def test_blue_sparks_are_not_a_slot_kind() -> None:
    # Deliberately out: nothing reads stat sparks yet, and their 70/80/90
    # bases would dominate every proc table if they were merely accepted.
    _rejects(doc(named={1: slot(1002, factors=[{"kind": "blue", "key": 1, "stars": 3}])}),
             "kind")


def test_factors_default_to_empty_so_older_rows_parse() -> None:
    # The one way this document is allowed to grow (DECISIONS.md #28): every
    # blueprint saved before this field existed must still validate, and read
    # as a member carrying none rather than failing the whole list.
    body = BlueprintIn.model_validate(doc(named=FULL_TRIANGLE))
    named1 = body.slots.named[1]
    assert named1 is not None
    assert named1.factors == []


def test_factors_survive_the_document_round_trip() -> None:
    body = BlueprintIn.model_validate(
        doc(named={1: slot(1002, factors=[white(), white(20141, 1)])})
    )
    assert out_of(body).slots == body.slots


def test_duplicate_sparks_rejected() -> None:
    # The proc estimate combines a spark's carriers, so the same one twice on
    # one member would roll it against itself.
    _rejects(
        doc(named={1: slot(1002, factors=[white(20035, 2), white(20035, 1)])}),
        "same spark twice",
    )


def test_the_same_key_under_two_kinds_is_legal() -> None:
    # The kinds number their keys independently — a race and a white can
    # collide on a number and still be different sparks.
    body = BlueprintIn.model_validate(
        doc(named={1: slot(1002, factors=[{"kind": "white", "key": 500, "stars": 1},
                                          {"kind": "race", "key": 500, "stars": 1}])})
    )
    named1 = body.slots.named[1]
    assert named1 is not None
    assert len(named1.factors) == 2


@pytest.mark.parametrize("stars", [0, 4])
def test_spark_star_range_enforced(stars: int) -> None:
    _rejects(doc(named={1: slot(1002, factors=[white(stars=stars)])}), "factors")


def test_named_slot_may_carry_sparks_without_a_pink_or_a_character() -> None:
    # "The parent who carries these two whites" is a plan in its own right
    # now that the document holds non-pink sparks. Requiring a pink beside
    # them would make clearing the pink destroy the spark list, since a slot
    # carrying neither is pruned away.
    body = BlueprintIn.model_validate(
        doc(named={1: {"source": "catalog", "chara_id": None, "card_id": None,
                       "factors": [white()]}})
    )
    parent1 = body.slots.named[1]
    assert parent1 is not None
    assert parent1.spark is None
    assert len(parent1.factors) == 1


def test_trainee_cannot_carry_non_pink_sparks_either() -> None:
    # Same reason her pink is refused: nothing is bred from her here.
    _rejects(
        doc(named={0: slot(1001, factors=[white()])}),
        "the trainee slot can't carry a spark",
    )


def test_foreign_green_rejected_on_a_cast_slot() -> None:
    # A green's key IS the card_id (DECISIONS.md #36/#39) — Silence Suzuka's
    # green on a Special Week node is a spark that member can never carry,
    # and it was producing a proc estimate before this rule.
    _rejects(
        doc(named={1: slot(1002, factors=[{"kind": "unique", "key": 100101, "stars": 3}])}),
        "own unique",
    )


def test_foreign_green_rejected_on_a_pulled_slot_too() -> None:
    # The pull path copies the dump's factors verbatim, so the rule must
    # reach lineage/roster slots — a source check slipped in front of the
    # loop would exempt exactly the branch the client marks read-only.
    _rejects(
        doc(named={3: slot(1004, source="lineage", trained_chara_id=900001,
                           position_id=10,
                           factors=[{"kind": "unique", "key": 100101, "stars": 3}])}),
        "own unique",
    )


def test_npc_variant_card_green_is_uncheckable_and_stays_legal() -> None:
    # The two 7-digit NPC copies in cards.json have no unique factor at their
    # own id — no green can satisfy "her own" there, and a pulled branch's
    # sparks are locked client-side, so rejecting would leave the document
    # permanently unsavable (DECISIONS.md #39).
    body = BlueprintIn.model_validate(
        doc(named={1: {"source": "catalog", "chara_id": 1001, "card_id": 9100101,
                       "factors": [{"kind": "unique", "key": 100101, "stars": 3}]}})
    )
    parent1 = body.slots.named[1]
    assert parent1 is not None
    assert parent1.factors[0].key == 100101


def test_green_on_a_characterless_slot_stays_legal() -> None:
    # "Whatever carries this green" is a plan (#30, #36's uncast tier) — with
    # no card there is nothing to check the key against.
    body = BlueprintIn.model_validate(
        doc(named={1: {"source": "catalog", "chara_id": None, "card_id": None,
                       "factors": [{"kind": "unique", "key": 100101, "stars": 3}]}})
    )
    parent1 = body.slots.named[1]
    assert parent1 is not None
    assert parent1.factors[0].key == 100101


def test_a_pre_rule_mismatched_green_still_reads() -> None:
    # The rule is write-only (DECISIONS.md #39): BlueprintOut must keep
    # parsing a row saved before it landed, or one document would 500 the
    # whole blueprint list.
    body = BlueprintIn.model_validate(doc(named={1: slot(1002)}))
    stored = body.slots.model_dump()
    named1 = stored["named"][1]
    assert named1 is not None
    named1["factors"] = [{"kind": "unique", "key": 100101, "stars": 3}]
    out = out_of(body, stored)
    named1_out = out.slots.named[1]
    assert named1_out is not None
    assert named1_out.factors[0].key == 100101


def test_unknown_spark_key_accepted() -> None:
    # Deliberate: app/data is regenerated by hand and can run behind a dump
    # that already carries a new skill. Rejecting the key would turn a
    # reference gap into a saved blueprint that 500s the whole list on read.
    body = BlueprintIn.model_validate(doc(named={1: slot(1002, factors=[white(999_999, 3)])}))
    named1 = body.slots.named[1]
    assert named1 is not None
    assert named1.factors[0].key == 999_999


def test_factor_reference_serves_every_pickable_kind() -> None:
    # What the hand-entry picker lists, from the same committed reference the
    # decoder reads.
    kinds = {f.kind for f in PICKABLE_FACTORS}
    assert kinds == {"white", "unique", "race", "scenario"}
    # Grouped by kind, then alphabetical within it — the picker searches names
    # and shows the kind, so this is the order it renders in.
    assert sorted(PICKABLE_FACTORS, key=lambda f: (f.kind, f.name)) == PICKABLE_FACTORS
    ids = [(f.kind, f.key) for f in PICKABLE_FACTORS]
    assert len(set(ids)) == len(ids)
    # Keys a real dump decodes to must be pickable by hand as well, or the two
    # paths would disagree about what a spark is.
    assert ("white", 20035) in ids
    assert ("unique", 100101) in ids
    # Pinks and blues have no place here: the pink has its own editor, and
    # blue is not a slot kind at all.
    assert all(f.kind not in {"pink", "blue"} for f in PICKABLE_FACTORS)


async def test_factors_endpoint_serves_the_reference_over_http() -> None:
    # Driven through httpx's ASGI transport rather than fastapi's TestClient,
    # which is deprecated against the httpx version pinned here and warns.
    import httpx

    from app.main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/factors")
    assert response.status_code == 200
    body = response.json()
    assert len(body) == len(PICKABLE_FACTORS)
    # The serialized shape is the contract the picker reads: kind, key, name
    # and nothing else — the frontend types it exactly this way.
    assert body[0].keys() == {"kind", "key", "name"}
    assert body[0] == PICKABLE_FACTORS[0].model_dump()


# ---------- catalog shape (real committed data) ----------


def test_catalog_cards_are_sorted_with_base_first() -> None:
    for entry in CATALOG:
        card_ids = [card.card_id for card in entry.cards]
        assert card_ids == sorted(card_ids)
        assert all(derive_chara_id(card_id) == entry.chara_id for card_id in card_ids)
    # The base outfit (lowest card id) is the icon source — Special Week's
    # entry must lead with her base card.
    special_week = next(entry for entry in CATALOG if entry.chara_id == 1001)
    assert special_week.cards[0].card_id == 100101


def test_catalog_serves_only_playable_lettered_cards() -> None:
    # The 7-digit NPC/tutorial copies (9100101/9101101) are filtered out —
    # they duplicate a real card's chara and outfit label with no aptitude
    # rows — so every served card is a distinct playable pick with letters.
    for entry in CATALOG:
        for card in entry.cards:
            assert card.card_id <= 999_999
            assert card.aptitudes is not None


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


# ---------- what a slot may carry (the client mirrors these) ----------


def letters(**overrides: str) -> dict[str, str]:
    """A full ten-key aptitude map, the shape a roster pull snapshots."""
    return {**dict.fromkeys(get_args(AptitudeKey), "A"), **overrides}


def roster_slot(**overrides: Any) -> dict[str, Any]:
    return slot(1002, source="roster", trained_chara_id=900001, **overrides)


def test_roster_slot_takes_a_full_aptitude_map() -> None:
    body = BlueprintIn.model_validate(doc(named={1: roster_slot(aptitudes=letters(long="S"))}))
    got = body.slots.named[1]
    assert got is not None
    assert got.aptitudes is not None
    assert got.aptitudes["long"] == "S"
    assert len(got.aptitudes) == len(get_args(AptitudeKey))


def test_partial_aptitude_map_is_rejected() -> None:
    # The client reads the map as a whole and throws on a missing key, which
    # makes the blueprint unopenable — and unrepairable, since the designer is
    # the only way to edit one. The server has to be at least as strict as the
    # client that has to render what it stored.
    partial = letters()
    del partial["long"]
    with pytest.raises(ValidationError, match="all ten keys"):
        BlueprintIn.model_validate(doc(named={1: roster_slot(aptitudes=partial)}))


@pytest.mark.parametrize("bad", ["", "Z", "a", "A+"])
def test_non_grade_aptitude_letters_are_rejected(bad: str) -> None:
    with pytest.raises(ValidationError):
        BlueprintIn.model_validate(doc(named={1: roster_slot(aptitudes=letters(long=bad))}))


def test_only_a_roster_slot_carries_its_own_aptitudes() -> None:
    # A catalog pick is a card, not a horse, and the dump gives a lineage
    # member no aptitudes at all — so letters there would be invented.
    with pytest.raises(ValidationError, match="only a roster slot"):
        BlueprintIn.model_validate(doc(named={1: slot(1002, aptitudes=letters())}))


def test_a_named_slots_spark_carries_no_identity() -> None:
    # PinkSparkIn doubles as the generation-3/4 slot model, so it accepts a
    # card_id and a source. On a named slot those are meaningless — identity
    # lives in the slot's own fields — and the client drops them on read, so
    # accepting them would make the round-trip silently lossy.
    for extra in ({"card_id": 100201}, {"card_id": 100201, "source": "roster"}):
        with pytest.raises(ValidationError, match="no identity of its own"):
            BlueprintIn.model_validate(doc(named={1: slot(1002, spark={**pink(), **extra})}))


def test_a_deep_slot_keeps_its_source_through_the_round_trip() -> None:
    # `source` is what marks a branch as recorded history: every read-only
    # lock in the designer derives from it, so it has to survive JSONB and
    # come back out of BlueprintOut intact.
    body = BlueprintIn.model_validate(
        doc(sparks={7: {"card_id": 100201, "source": "lineage", **pink("long", 2)}})
    )
    got = out_of(body).slots.sparks[0]
    assert got is not None
    assert got.source == "lineage"
    assert got.card_id == 100201
    assert got.stars == 2


def test_a_deep_slot_source_still_needs_a_character() -> None:
    with pytest.raises(ValidationError, match="a pulled slot needs a character"):
        BlueprintIn.model_validate(doc(sparks={7: {"source": "roster", **pink()}}))
