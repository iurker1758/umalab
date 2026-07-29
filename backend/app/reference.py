"""Bundled reference data, loaded once at import.

The JSON files in app/data/ are committed and regenerated manually
(scripts/build_reference_data.py; DECISIONS.md #6). Factor names and types
come from the game's own text_data via uma.moe (DECISIONS.md #8).
"""
import json
from pathlib import Path
from typing import TypedDict

DATA_DIR = Path(__file__).resolve().parent / "data"


class Card(TypedDict):
    chara_id: int
    name: str
    outfit: str


class FactorInfo(TypedDict):
    name: str
    type: int


def _load_cards() -> dict[int, Card]:
    raw = json.loads((DATA_DIR / "cards.json").read_text(encoding="utf-8"))
    return {int(card_id): card for card_id, card in raw.items()}


def _load_factors() -> dict[int, FactorInfo]:
    raw = json.loads((DATA_DIR / "factors.json").read_text(encoding="utf-8"))
    return {int(key): info for key, info in raw.items()}


def _load_tag_icons() -> list[str]:
    raw = json.loads((DATA_DIR / "tag_icons.json").read_text(encoding="utf-8"))
    return list(raw)


CARDS: dict[int, Card] = _load_cards()
FACTORS: dict[int, FactorInfo] = _load_factors()
# The fixed set of assignable tag ids (favorite-mark icons; DECISIONS.md #9).
# Ids only — the art itself is extracted locally by scripts/extract_fav_icons.py.
TAG_ICONS: list[str] = _load_tag_icons()

# uma.moe's `type` field -> the kind label stored on decoded factors.
FACTOR_TYPE_KINDS: dict[int, str] = {
    0: "blue",
    1: "pink",
    2: "race",
    3: "white",
    4: "scenario",
    5: "unique",
}
