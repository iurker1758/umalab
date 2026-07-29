"""Bundled reference data, loaded once at import.

The JSON files in app/data/ are committed and regenerated manually
(scripts/build_reference_data.py; DECISIONS.md #6). The blue/pink constants
live here because they're tiny and hand-verified (DECISIONS.md #8).
"""
import json
from pathlib import Path
from typing import TypedDict

DATA_DIR = Path(__file__).resolve().parent / "data"


class Card(TypedDict):
    chara_id: int
    name: str
    outfit: str


def _load_cards() -> dict[int, Card]:
    raw = json.loads((DATA_DIR / "cards.json").read_text(encoding="utf-8"))
    return {int(card_id): card for card_id, card in raw.items()}


def _load_factor_names() -> dict[int, str]:
    raw = json.loads((DATA_DIR / "factor_names.json").read_text(encoding="utf-8"))
    return {int(key): name for key, name in raw.items()}


CARDS: dict[int, Card] = _load_cards()
WHITE_FACTOR_NAMES: dict[int, str] = _load_factor_names()

# TODO: verify against an official factor table. Labels follow the game's
# canonical stat order (matching the dump's field order); the decoder degrades
# to "Blue N" if an unexpected key ever appears.
BLUE_FACTOR_NAMES: dict[int, str] = {
    1: "Speed",
    2: "Stamina",
    3: "Power",
    4: "Guts",
    5: "Wit",
}

# Verified: consistent with all 99 veterans of a real dump under the in-game
# rule that pink sparks only roll on A-or-better aptitudes (DECISIONS.md #8).
PINK_FACTOR_NAMES: dict[int, str] = {
    11: "Turf",
    12: "Dirt",
    21: "Front Runner",
    22: "Pace Chaser",
    23: "Late Surger",
    24: "End Closer",
    31: "Short",
    32: "Mile",
    33: "Medium",
    34: "Long",
}
