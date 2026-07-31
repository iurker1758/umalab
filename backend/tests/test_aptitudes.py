"""Shape sanity + anchors for the committed aptitudes.json.

Like the real-data tests in test_affinity.py, these guard a regenerated
file against corruption; the letter-scale mapping itself (1=G .. 7=A) was
anchored against known in-game career-start screens (Haru Urara's
Turf G / Dirt A / Sprint A / Late A, Special Week's Turf A / Mile C).
"""
from app.reference import APTITUDES, CARDS, CardAptitudes

APTITUDE_KEYS = {
    "turf", "dirt",
    "sprint", "mile", "medium", "long",
    "front", "pace", "late", "end",
}
VALID_LETTERS = set("GFEDCBAS")


def test_every_entry_is_complete_and_lettered() -> None:
    assert len(APTITUDES) >= 90  # full Global roster, not a truncated read
    for apt in APTITUDES.values():
        assert set(apt) == APTITUDE_KEYS
        assert all(letter in VALID_LETTERS for letter in apt.values())


def test_every_aptitude_card_is_a_known_card() -> None:
    # The reverse doesn't hold: cards.json carries two NPC/tutorial card
    # copies (91xxxxx) that have no card_rarity_data rows.
    assert set(APTITUDES) <= set(CARDS)


def test_anchor_special_week() -> None:
    # In-game career-start screen values for the base card.
    expected: CardAptitudes = {
        "turf": "A", "dirt": "G",
        "sprint": "F", "mile": "C", "medium": "A", "long": "A",
        "front": "G", "pace": "A", "late": "A", "end": "C",
    }
    assert APTITUDES[100101] == expected


def test_aptitudes_are_per_card_not_per_chara() -> None:
    # Haru Urara's New Year outfit runs Mile A against her base card's B —
    # the reason this file keys on card_id. A regen that collapsed to
    # chara_id would erase the difference.
    base, alt = APTITUDES[105201], APTITUDES[105202]
    assert base["mile"] == "B"
    assert alt["mile"] == "A"
    assert {k: v for k, v in base.items() if k != "mile"} == {
        k: v for k, v in alt.items() if k != "mile"
    }
