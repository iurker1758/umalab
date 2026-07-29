"""Tests for the pure dump-parsing/decoding module. Fixtures are synthetic —
never a real extractor dump.
"""
import pytest

from app.ingest import IngestError, decode_factor, derive_chara_id, parse_dump, parse_veteran
from app.reference import Card

CARDS: dict[int, Card] = {
    101701: {"chara_id": 1017, "name": "Symboli Rudolf", "outfit": "Original"},
    103201: {"chara_id": 1032, "name": "Agnes Tachyon", "outfit": "Original"},
    100101: {"chara_id": 1001, "name": "Special Week", "outfit": "Original"},
}

WHITE_NAMES: dict[int, str] = {
    20035: "Corner Recovery",
    20038: "Straightaway Recovery",
}


def make_lineage_member(position_id: int, card_id: int = 100101) -> dict[str, object]:
    return {
        "position_id": position_id,
        "card_id": card_id,
        "rarity": 3,
        "talent_level": 2,
        "rank": 10,
        "factor_info_array": [{"factor_id": 2003501, "level": 0}],
    }


def make_veteran(trained_chara_id: int = 7001, card_id: int = 103201) -> dict[str, object]:
    return {
        "trained_chara_id": trained_chara_id,
        "card_id": card_id,
        "rarity": 3,
        "talent_level": 3,
        "rank": 12,
        "rank_score": 10661,
        "fans": 123456,
        "wins": 10,
        "speed": 1190,
        "stamina": 631,
        "power": 746,
        "guts": 354,
        "wiz": 456,
        "proper_distance_short": 1,
        "proper_distance_mile": 7,
        "proper_distance_middle": 8,
        "proper_distance_long": 3,
        "proper_ground_turf": 8,
        "proper_ground_dirt": 1,
        "proper_running_style_nige": 7,
        "proper_running_style_senko": 8,
        "proper_running_style_sashi": 3,
        "proper_running_style_oikomi": 1,
        "register_time": "2025-07-17 16:51:51",
        "skill_array": [{"skill_id": 200351, "level": 1}],
        "factor_info_array": [
            {"factor_id": 303, "level": 0},
            {"factor_id": 3402, "level": 0},
            {"factor_id": 2003502, "level": 0},
            {"factor_id": 10170103, "level": 0},
        ],
        "succession_chara_array": [
            make_lineage_member(10, 101701),
            make_lineage_member(20, 100101),
            make_lineage_member(11),
            make_lineage_member(12),
            make_lineage_member(21),
            make_lineage_member(22),
        ],
    }


# ---------- decode_factor ----------

def test_blue_factor():
    assert decode_factor(303, CARDS, WHITE_NAMES) == {
        "factor_id": 303, "kind": "blue", "key": 3, "star": 3, "name": "Power",
    }


def test_blue_factor_unknown_key_degrades():
    assert decode_factor(903, CARDS, WHITE_NAMES)["name"] == "Blue 9"


def test_pink_factor():
    decoded = decode_factor(3402, CARDS, WHITE_NAMES)
    assert (decoded["kind"], decoded["key"], decoded["star"]) == ("pink", 34, 2)
    assert decoded["name"] == "Long"


def test_pink_factor_unknown_key_degrades():
    assert decode_factor(9902, CARDS, WHITE_NAMES)["name"] == "Pink 99"


def test_white_factor():
    decoded = decode_factor(2003502, CARDS, WHITE_NAMES)
    assert (decoded["kind"], decoded["key"], decoded["star"]) == ("white", 20035, 2)
    assert decoded["name"] == "Corner Recovery"


def test_white_factor_unknown_key_falls_back():
    assert decode_factor(2102101, CARDS, WHITE_NAMES)["name"] == "Unknown (21021)"


def test_unique_factor_named_from_card():
    decoded = decode_factor(10170103, CARDS, WHITE_NAMES)
    assert (decoded["kind"], decoded["key"], decoded["star"]) == ("unique", 101701, 3)
    assert decoded["name"] == "Symboli Rudolf (unique)"


def test_unique_factor_unknown_card_falls_back():
    assert decode_factor(99999901, CARDS, WHITE_NAMES)["name"] == "Card 999999 (unique)"


def test_star_comes_from_id_not_level():
    # the dump's `level` field is always 0; only the id encodes the star
    assert decode_factor(2003503, CARDS, WHITE_NAMES)["star"] == 3


# ---------- derive_chara_id ----------

def test_chara_id_from_six_digit_card():
    assert derive_chara_id(103201) == 1032


def test_chara_id_from_seven_digit_card():
    assert derive_chara_id(9100101) == 1001


# ---------- parse_veteran ----------

def test_parse_veteran_scalars_and_card_label():
    veteran = parse_veteran(make_veteran(), CARDS, WHITE_NAMES)
    assert veteran["trained_chara_id"] == 7001
    assert veteran["chara_id"] == 1032  # derived; the dump's own field is null
    assert (veteran["name"], veteran["outfit"]) == ("Agnes Tachyon", "Original")
    assert veteran["speed"] == 1190
    assert veteran["register_time"] == "2025-07-17 16:51:51"


def test_parse_veteran_unknown_card_falls_back():
    veteran = parse_veteran(make_veteran(card_id=888888), CARDS, WHITE_NAMES)
    assert (veteran["name"], veteran["outfit"]) == ("Card 888888", "")


def test_parse_veteran_decodes_own_factors():
    veteran = parse_veteran(make_veteran(), CARDS, WHITE_NAMES)
    assert [f["kind"] for f in veteran["factors"]] == ["blue", "pink", "white", "unique"]
    assert all(f["factor_id"] for f in veteran["factors"])  # raw id always retained


def test_parse_veteran_lineage_relations():
    lineage = parse_veteran(make_veteran(), CARDS, WHITE_NAMES)["lineage"]
    relations = {m["position_id"]: m["relation"] for m in lineage}
    assert relations == {
        10: "parent", 20: "parent",
        11: "grandparent", 12: "grandparent", 21: "grandparent", 22: "grandparent",
    }
    assert lineage[0]["name"] == "Symboli Rudolf"
    assert lineage[0]["factors"][0]["name"] == "Corner Recovery"
    assert lineage[0]["factors"][0]["star"] == 1


def test_parse_veteran_keeps_raw_skills():
    veteran = parse_veteran(make_veteran(), CARDS, WHITE_NAMES)
    assert veteran["skills"] == [{"skill_id": 200351, "level": 1}]


def test_parse_veteran_missing_field_raises():
    raw = make_veteran()
    del raw["speed"]
    with pytest.raises(IngestError, match="missing 'speed'"):
        parse_veteran(raw, CARDS, WHITE_NAMES)


def test_parse_veteran_null_field_raises():
    raw = make_veteran()
    raw["rank_score"] = None
    with pytest.raises(IngestError, match="missing 'rank_score'"):
        parse_veteran(raw, CARDS, WHITE_NAMES)


# ---------- parse_dump ----------

def test_parse_dump_happy_path():
    dump = [make_veteran(7001), make_veteran(7002)]
    assert len(parse_dump(dump, CARDS, WHITE_NAMES)) == 2


def test_parse_dump_rejects_non_list():
    with pytest.raises(IngestError, match="JSON array"):
        parse_dump({"trained_chara_array": []}, CARDS, WHITE_NAMES)


def test_parse_dump_rejects_non_object_items():
    with pytest.raises(IngestError, match="JSON object"):
        parse_dump(["nope"], CARDS, WHITE_NAMES)


def test_parse_dump_rejects_duplicate_ids():
    with pytest.raises(IngestError, match="duplicate trained_chara_id 7001"):
        parse_dump([make_veteran(7001), make_veteran(7001)], CARDS, WHITE_NAMES)


def test_parse_dump_empty_is_valid():
    assert parse_dump([], CARDS, WHITE_NAMES) == []
