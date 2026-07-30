"""Tests for the pure affinity module. Relation fixtures are synthetic; the
real committed reference data is touched only by the sanity checks at the
bottom (shape/symmetry, not exact values — exact in-game anchors are added
once verified against the parent-select screen).
"""
from app.affinity import (
    RELATION_LINKS,
    WIN_POINTS_PER_SHARED_G1,
    RelationTable,
    Slot,
    build_relation_table,
    g1_wins,
    rel2,
    rel3,
    score_blueprint,
    symbol_for,
)
from app.reference import (
    AFFINITY_RANKS,
    RELATION_MEMBERS,
    RELATION_POINTS,
    SADDLES,
    RankBand,
    SaddleInfo,
)

# Charas 100/200/300/400 across four groups: 1 and 2 bind 100+200, group 2
# adds 300 (the only three-way group), group 4 pairs 100 with 400.
POINTS = {1: 10, 2: 5, 3: 7, 4: 100}
MEMBERS = {1: [100, 200], 2: [100, 200, 300], 3: [200, 300], 4: [100, 400]}
TABLE = build_relation_table(POINTS, MEMBERS)

RANKS: list[RankBand] = [
    {"max": 50, "symbol": "△"},
    {"max": 150, "symbol": "○"},
    {"max": 9999, "symbol": "◎"},
]

SADDLE_FIXTURE: dict[int, SaddleInfo] = {
    1: {"name": "Triple Crown", "g1_race_ids": [5, 10, 15]},
    2: {"name": "Derby", "g1_race_ids": [10]},
    3: {"name": "A G2 saddle", "g1_race_ids": []},
}


# ---------- relation sums ----------


def test_rel2_sums_shared_groups() -> None:
    assert rel2(TABLE, 100, 200) == 15  # groups 1 + 2


def test_rel2_is_symmetric() -> None:
    assert rel2(TABLE, 100, 300) == rel2(TABLE, 300, 100) == 5


def test_rel2_unknown_chara_scores_zero() -> None:
    assert rel2(TABLE, 100, 99999) == 0


def test_rel3_needs_all_three_members() -> None:
    # Group 1 holds 100+200 but not 300; only group 2 holds all three.
    assert rel3(TABLE, 100, 200, 300) == 5


def test_rel3_no_common_group() -> None:
    assert rel3(TABLE, 100, 200, 400) == 0


# ---------- symbols ----------


def test_symbol_thresholds() -> None:
    assert symbol_for(0, RANKS) == "△"
    assert symbol_for(50, RANKS) == "△"
    assert symbol_for(51, RANKS) == "○"
    assert symbol_for(150, RANKS) == "○"
    assert symbol_for(151, RANKS) == "◎"


def test_symbol_above_every_band_keeps_last() -> None:
    assert symbol_for(99999, RANKS) == "◎"


# ---------- win expansion ----------


def test_g1_wins_unions_composites() -> None:
    # Triple Crown + a component race dedupe; G2 saddles and unknown ids add nothing.
    assert g1_wins([1, 2, 3, 999], SADDLE_FIXTURE) == frozenset({5, 10, 15})


def test_g1_wins_empty() -> None:
    assert g1_wins([], SADDLE_FIXTURE) == frozenset()


# ---------- blueprint scoring ----------


def test_full_tree_totals_decompose() -> None:
    result = score_blueprint(
        TABLE, 100,
        p1=Slot(200), p2=Slot(300),
        g11=Slot(300), g12=Slot(400), g21=Slot(200), g22=Slot(400),
    )
    by_link = {entry["link"]: entry["relation_points"] for entry in result["links"]}
    assert by_link == {
        "t-p1": 15,        # rel2(100, 200)
        "t-p2": 5,         # rel2(100, 300)
        "p1-p2": 12,       # rel2(200, 300): groups 2 + 3
        "t-p1-g11": 5,     # rel3(100, 200, 300)
        "t-p1-g12": 0,     # rel3(100, 200, 400)
        "t-p2-g21": 5,     # rel3(100, 300, 200)
        "t-p2-g22": 0,     # rel3(100, 300, 400)
    }
    assert result["relation_total"] == 42
    assert result["win_total"] == 0
    assert result["total"] == 42
    assert result["p1_affinity"] == 15 + 5 + 0
    assert result["p2_affinity"] == 5 + 5 + 0


def test_partial_blueprint_scores_live() -> None:
    result = score_blueprint(TABLE, 100, p1=Slot(200))
    assert result["total"] == 15
    assert result["p1_affinity"] == 15
    assert result["p2_affinity"] is None


def test_trainee_only_scores_zero() -> None:
    result = score_blueprint(TABLE, 100)
    assert result["total"] == 0
    assert result["p1_affinity"] is None
    assert result["p2_affinity"] is None


def test_shared_wins_score_on_parent_links() -> None:
    result = score_blueprint(
        TABLE, 100,
        p1=Slot(200, wins=frozenset({10, 15})),
        p2=Slot(300, wins=frozenset({10})),
        g11=Slot(400, wins=frozenset({15})),
    )
    win_by_link = {entry["link"]: entry["win_points"] for entry in result["links"]}
    # p1-p2 share race 10; p1 and its own grandparent g11 share race 15.
    assert win_by_link["p1-p2"] == WIN_POINTS_PER_SHARED_G1
    assert win_by_link["t-p1-g11"] == WIN_POINTS_PER_SHARED_G1
    assert result["win_total"] == 2 * WIN_POINTS_PER_SHARED_G1
    # Parent-own-grandparent wins count toward that parent's individual
    # affinity; the p1-p2 overlap doesn't (pending in-game verification).
    assert result["p1_affinity"] == 15 + WIN_POINTS_PER_SHARED_G1
    assert result["p2_affinity"] == 5


def test_cross_family_wins_never_score() -> None:
    # p1 shares a race with p2's grandparent — no link exists between them.
    result = score_blueprint(
        TABLE, 100,
        p1=Slot(200, wins=frozenset({10})),
        p2=Slot(300),
        g21=Slot(400, wins=frozenset({10})),
    )
    assert result["win_total"] == 0


def test_duplicate_race_counts_once() -> None:
    # Two saddles covering the same race collapse in g1_wins, so the shared
    # set can't double-count; a shared pair is worth exactly one bonus.
    wins = g1_wins([1, 2], SADDLE_FIXTURE)  # race 10 appears in both saddles
    result = score_blueprint(
        TABLE, 100, p1=Slot(200, wins=wins), p2=Slot(300, wins=frozenset({10}))
    )
    assert result["win_total"] == WIN_POINTS_PER_SHARED_G1


def test_grandparent_repeating_trainee_chara_scores_zero() -> None:
    # In-game verified (2026-07-30): a grandparent slot holding the trainee's
    # own chara contributes nothing to its triple. Chara 100 as g11 under
    # parent 200 would otherwise re-add rel3(100, 200, 100) = rel2-level pts.
    with_dupe = score_blueprint(TABLE, 100, p1=Slot(200), g11=Slot(100))
    without_gp = score_blueprint(TABLE, 100, p1=Slot(200))
    assert with_dupe["relation_total"] == without_gp["relation_total"]


def test_grandparent_repeating_parent_chara_scores_zero() -> None:
    with_dupe = score_blueprint(TABLE, 100, p1=Slot(200), g11=Slot(200))
    without_gp = score_blueprint(TABLE, 100, p1=Slot(200))
    assert with_dupe["relation_total"] == without_gp["relation_total"]


def test_excluded_grandparent_wins_still_count() -> None:
    # The exclusion is relation-only: the duplicate-chara slot's races still
    # overlap (GameTora applies race bonuses per slot, chara-blind).
    r = score_blueprint(
        TABLE, 100,
        p1=Slot(200, wins=frozenset({10})),
        g11=Slot(100, wins=frozenset({10})),
    )
    assert r["win_total"] == WIN_POINTS_PER_SHARED_G1


# ---------- in-game verified anchors (Global client, 2026-07-30) ----------
# Slot data extracted from a real UmaExtractor dump; expected totals were
# verified against the parent-select symbols in three rounds of checks.


def _real_table() -> RelationTable:
    from app.reference import RELATION_MEMBERS, RELATION_POINTS

    return build_relation_table(RELATION_POINTS, RELATION_MEMBERS)


# Win sets for the anchor blueprints, as G1 race ids.
_HARU = frozenset({1001, 1104})
_MARU_GP = frozenset(
    {1003, 1005, 1007, 1008, 1010, 1011, 1013, 1016, 1017, 1018, 1019, 1022, 1023}
)
_RUDOLF_GP = frozenset({1003, 1005, 1010, 1015, 1017, 1019, 1023, 1024})


def test_anchor_trainee_in_lineage_triangle() -> None:
    # Trainee Special Week (1001); p1 Taiki Shuttle whose own parent IS
    # Special Week — the exclusion drops this pair to △ (game-confirmed).
    r = score_blueprint(
        _real_table(), 1001,
        p1=Slot(1010, wins=frozenset({1007, 1011, 1013, 1018})),
        g11=Slot(1001, wins=frozenset({1006, 1016, 1019, 1023, 1024})),
        g12=Slot(1032, wins=frozenset({1003, 1010, 1016, 1019, 1023})),
        p2=Slot(1052, wins=_HARU),
        g21=Slot(1004, wins=_MARU_GP),
        g22=Slot(1017, wins=_RUDOLF_GP),
    )
    assert r["total"] == 47
    assert symbol_for(r["total"], RANKS) == "△"


def test_anchor_circle_with_win_bonus() -> None:
    # Trainee Special Week; Maruzensky x Haru Urara — game-confirmed ○.
    r = score_blueprint(
        _real_table(), 1001,
        p1=Slot(1004, wins=frozenset({1003, 1005, 1010, 1011, 1016, 1022, 1023})),
        g11=Slot(
            1024,
            wins=frozenset({1005, 1006, 1010, 1012, 1015, 1016, 1017, 1019, 1023, 1024}),
        ),
        g12=Slot(1020, wins=frozenset({1005, 1010, 1012, 1016, 1017, 1019, 1023, 1024})),
        p2=Slot(1052, wins=_HARU),
        g21=Slot(1004, wins=_MARU_GP),
        g22=Slot(1017, wins=_RUDOLF_GP),
    )
    assert r["total"] == 71
    assert symbol_for(r["total"], RANKS) == "○"


def test_anchor_double_circle_win_heavy() -> None:
    # Trainee Mayano Top Gun; Smart Falcon x Taiki Shuttle — game-confirmed
    # ◎ with 90 of its points from shared G1 wins.
    r = score_blueprint(
        _real_table(), 1024,
        p1=Slot(
            1046,
            wins=frozenset(
                {1002, 1004, 1007, 1008, 1009, 1011, 1012, 1013, 1014, 1017, 1018,
                 1020, 1022, 1024, 1101, 1103, 1106}
            ),
        ),
        g11=Slot(
            1026,
            wins=frozenset(
                {1003, 1005, 1006, 1007, 1008, 1010, 1011, 1012, 1015, 1016, 1017,
                 1019, 1022, 1023}
            ),
        ),
        g12=Slot(
            1020,
            wins=frozenset(
                {1003, 1005, 1006, 1007, 1008, 1010, 1011, 1012, 1015, 1016, 1017,
                 1018, 1019, 1021, 1023, 1024}
            ),
        ),
        p2=Slot(
            1010,
            wins=frozenset(
                {1001, 1002, 1004, 1007, 1008, 1009, 1011, 1013, 1014, 1016, 1018,
                 1020, 1022, 1024, 1103, 1106}
            ),
        ),
        g21=Slot(1026, wins=frozenset({1005, 1008, 1010, 1019, 1022, 1023})),
        g22=Slot(1045, wins=frozenset({1003, 1005, 1006, 1010, 1012, 1016, 1017, 1019, 1023})),
    )
    assert r["total"] == 178
    assert r["win_total"] == 90
    assert symbol_for(r["total"], RANKS) == "◎"


# ---------- real committed data (shape sanity, not exact anchors) ----------


def test_real_ranks_match_game_bands() -> None:
    assert [band["max"] for band in AFFINITY_RANKS] == [50, 150, 9999]
    assert [band["symbol"] for band in AFFINITY_RANKS] == ["△", "○", "◎"]


def test_real_table_is_consistent() -> None:
    table = build_relation_table(RELATION_POINTS, RELATION_MEMBERS)
    # Every member group has a point value, and rel2 stays symmetric on the
    # real data for the flagship pairing.
    assert all(rt in RELATION_POINTS for rt in RELATION_MEMBERS)
    assert rel2(table, 1001, 1002) == rel2(table, 1002, 1001) > 0


def test_real_saddles_expand_to_known_g1s() -> None:
    # Classic Triple Crown = Satsuki Sho + Tokyo Yushun + Kikka Sho.
    assert sorted(g1_wins([1], SADDLES)) == [1005, 1010, 1015]


def test_real_races_are_venue_canonicalized() -> None:
    # Venue variants of a G1 must collapse to one id at build time — the
    # game matches wins across venues (in-game verified 2026-07-30). A
    # regenerated races.json that forgets this silently undercounts.
    from app.reference import RACE_NAMES

    names = list(RACE_NAMES.values())
    assert len(names) == len(set(names))


def test_links_constant_covers_all_edges() -> None:
    assert len(RELATION_LINKS) == 7
