"""Dump parsing and factor decoding — pure functions, no I/O, no ORM imports.

An UmaExtractor `data.json` is a JSON array of trained-character records
(the game's `trained_chara_array`). A factor id packs a spark as one int:
key = factor_id // 100, star = factor_id % 100 (the record's `level` field
is always 0 and is ignored).

The factor's kind and name come from the bundled factors reference (the
game's own factor table via uma.moe: blue/pink/race/white/scenario/unique).
Keys absent from the reference fall back to a range heuristic:
key < 10 blue, 10..99 pink, >= 100000 unique (key is the source card_id,
white keys are skill_id // 10).

`succession_chara_array` is the full 6-slot lineage: position_id 10/20 are
the parents; 11/12 and 21/22 are each parent's parents.

Won races come from `win_saddle_id_array` (raw saddle ids, kept as-is for
app/affinity.py's win bonus), present on the veteran and every lineage
member. The scalar `wins` count is NOT a substitute: the game backfilled
saddle arrays for all veterans but left `wins` at 0 for pre-Dec-2025 ones.

Reference dicts (cards, factors) are passed in so tests can use synthetic
fixtures.
"""
from __future__ import annotations

from typing import Any, cast

from .reference import FACTOR_TYPE_KINDS, Card, FactorInfo

PARENT_POSITIONS = (10, 20)

WIN_SADDLE_FIELD = "win_saddle_id_array"

VETERAN_INT_FIELDS = (
    "card_id",
    "trained_chara_id",
    "rarity",
    "talent_level",
    "rank",
    "rank_score",
    "fans",
    "wins",
    "speed",
    "stamina",
    "power",
    "guts",
    "wiz",
    "proper_distance_short",
    "proper_distance_mile",
    "proper_distance_middle",
    "proper_distance_long",
    "proper_ground_turf",
    "proper_ground_dirt",
    "proper_running_style_nige",
    "proper_running_style_senko",
    "proper_running_style_sashi",
    "proper_running_style_oikomi",
)


class IngestError(ValueError):
    """Malformed dump shape; the message is safe to show the user."""


def derive_chara_id(card_id: int) -> int:
    # 7-digit ids (rarity-0 NPC variants) prefix an extra digit: 9100101 -> 1001.
    return (card_id % 1_000_000) // 100 if card_id > 999_999 else card_id // 100


def card_label(card_id: int, cards: dict[int, Card]) -> tuple[str, str]:
    """(character name, outfit) with a readable fallback for unknown cards."""
    card = cards.get(card_id)
    if card is None:
        return f"Card {card_id}", ""
    return card["name"], card["outfit"]


def decode_factor(
    factor_id: int,
    cards: dict[int, Card],
    factors: dict[int, FactorInfo],
) -> dict[str, Any]:
    key, star = factor_id // 100, factor_id % 100
    info = factors.get(key)
    if info is not None:
        kind = FACTOR_TYPE_KINDS.get(info["type"], "other")
        name = info["name"]
    elif key < 10:
        kind, name = "blue", f"Blue {key}"
    elif key < 100:
        kind, name = "pink", f"Pink {key}"
    elif key >= 100_000:
        kind, name = "unique", f"{card_label(key, cards)[0]} (unique)"
    else:
        kind, name = "white", f"Unknown ({key})"
    return {"factor_id": factor_id, "kind": kind, "key": key, "star": star, "name": name}


def _require(record: dict[str, Any], field: str, context: str) -> Any:
    if field not in record or record[field] is None:
        raise IngestError(f"{context} is missing '{field}'")
    return record[field]


def _require_int(record: dict[str, Any], field: str, context: str) -> int:
    value = _require(record, field, context)
    # JSON booleans satisfy isinstance(int); they are never valid ids/stats.
    if not isinstance(value, int) or isinstance(value, bool):
        raise IngestError(f"{context} has a non-integer '{field}'")
    return value


def _decode_factor_list(
    record: dict[str, Any],
    cards: dict[int, Card],
    factors: dict[int, FactorInfo],
    context: str,
) -> list[dict[str, Any]]:
    entries: Any = record.get("factor_info_array") or []
    if not isinstance(entries, list):
        raise IngestError(f"{context} has a malformed 'factor_info_array'")
    decoded: list[dict[str, Any]] = []
    for entry in cast("list[Any]", entries):
        factor_id: Any = (
            cast("dict[str, Any]", entry).get("factor_id") if isinstance(entry, dict) else None
        )
        if not isinstance(factor_id, int):
            raise IngestError(f"{context} has a malformed factor entry")
        decoded.append(decode_factor(factor_id, cards, factors))
    return decoded


def _parse_win_saddles(record: dict[str, Any], context: str) -> list[int]:
    # Only truly absent win data degrades to no wins (risk noted in the plan:
    # a dump variant without the field loses win bonuses, not the import).
    # Any other shape — falsy ones like {} or 0 included — is a dump-format
    # change that must fail loudly, not import a winless roster.
    entries: Any = record.get(WIN_SADDLE_FIELD)
    if entries is None:
        return []
    if not isinstance(entries, list):
        raise IngestError(f"{context} has a malformed '{WIN_SADDLE_FIELD}'")
    for entry in cast("list[Any]", entries):
        if not isinstance(entry, int) or isinstance(entry, bool):
            raise IngestError(f"{context} has a non-integer won-saddle id")
    return cast("list[int]", entries)


def _parse_lineage_member(
    member: Any,
    cards: dict[int, Card],
    factors: dict[int, FactorInfo],
    context: str,
) -> dict[str, Any]:
    if not isinstance(member, dict):
        raise IngestError(f"{context} has a malformed lineage member")
    member = cast("dict[str, Any]", member)
    position_id = _require_int(member, "position_id", context)
    card_id = _require_int(member, "card_id", context)
    name, outfit = card_label(card_id, cards)
    return {
        "position_id": position_id,
        "relation": "parent" if position_id in PARENT_POSITIONS else "grandparent",
        "card_id": card_id,
        "chara_id": derive_chara_id(card_id),
        "name": name,
        "outfit": outfit,
        "rarity": member.get("rarity", 0),
        "talent_level": member.get("talent_level", 0),
        "rank": member.get("rank", 0),
        "factors": _decode_factor_list(member, cards, factors, context),
        "win_saddles": _parse_win_saddles(member, context),
    }


def parse_veteran(
    raw: dict[str, Any],
    cards: dict[int, Card],
    factors: dict[int, FactorInfo],
) -> dict[str, Any]:
    """One dump record -> a dict matching the Veteran model's columns."""
    context = f"veteran (trained_chara_id={raw.get('trained_chara_id', '?')})"
    fields: dict[str, Any] = {}
    for field in VETERAN_INT_FIELDS:
        fields[field] = _require_int(raw, field, context)

    fields["chara_id"] = derive_chara_id(fields["card_id"])
    fields["name"], fields["outfit"] = card_label(fields["card_id"], cards)
    fields["register_time"] = str(raw.get("register_time") or "")[:19]
    fields["factors"] = _decode_factor_list(raw, cards, factors, context)
    fields["win_saddles"] = _parse_win_saddles(raw, context)

    skills: Any = raw.get("skill_array") or []
    if not isinstance(skills, list):
        raise IngestError(f"{context} has a malformed 'skill_array'")
    fields["skills"] = cast("list[Any]", skills)

    succession: Any = raw.get("succession_chara_array") or []
    if not isinstance(succession, list):
        raise IngestError(f"{context} has a malformed 'succession_chara_array'")
    fields["lineage"] = [
        _parse_lineage_member(member, cards, factors, context)
        for member in cast("list[Any]", succession)
    ]
    return fields


def parse_dump(
    data: Any,
    cards: dict[int, Card],
    factors: dict[int, FactorInfo],
) -> list[dict[str, Any]]:
    """A whole data.json -> Veteran column dicts. Raises IngestError when malformed."""
    if not isinstance(data, list):
        raise IngestError("expected a JSON array of veterans (an UmaExtractor data.json)")
    veterans: list[dict[str, Any]] = []
    seen: set[int] = set()
    for raw in cast("list[Any]", data):
        if not isinstance(raw, dict):
            raise IngestError("expected every veteran to be a JSON object")
        veteran = parse_veteran(cast("dict[str, Any]", raw), cards, factors)
        if veteran["trained_chara_id"] in seen:
            raise IngestError(
                f"duplicate trained_chara_id {veteran['trained_chara_id']} in dump"
            )
        seen.add(veteran["trained_chara_id"])
        veterans.append(veteran)
    return veterans
