"""Tests for the pure affinity module. Relation fixtures are synthetic; the
real committed reference data is touched only by the anchor tests (which
also exercise the saddle→race expansion pipeline production uses) and the
shape sanity checks at the bottom.
"""
from app.affinity import (
    RELATION_LINKS,
    WIN_POINTS_PER_SHARED_G1,
    RelationTable,
    Slot,
    WinSet,
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


def _w(*race_ids: int) -> WinSet:
    """Won-race set literal for fixtures (canonical G1 race ids)."""
    return WinSet(frozenset(race_ids))


# ---------- relation sums ----------


def test_rel2_sums_shared_groups() -> None:
    assert rel2(TABLE, 100, 200) == 15  # groups 1 + 2


def test_rel2_is_symmetric() -> None:
    assert rel2(TABLE, 100, 300) == rel2(TABLE, 300, 100) == 5


def test_rel2_unknown_chara_scores_zero() -> None:
    assert rel2(TABLE, 100, 99999) == 0


def test_rel2_same_chara_scores_zero() -> None:
    # Self-affinity would otherwise sum every group the chara belongs to.
    assert rel2(TABLE, 100, 100) == 0


def test_rel3_needs_all_three_members() -> None:
    # Group 1 holds 100+200 but not 300; only group 2 holds all three.
    assert rel3(TABLE, 100, 200, 300) == 5


def test_rel3_no_common_group() -> None:
    assert rel3(TABLE, 100, 200, 400) == 0


def test_rel3_any_duplicate_scores_zero() -> None:
    assert rel3(TABLE, 100, 200, 100) == 0
    assert rel3(TABLE, 100, 200, 200) == 0
    assert rel3(TABLE, 100, 100, 200) == 0


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


def test_no_trainee_scores_trainee_independent_links() -> None:
    # A saved draft can lack a trainee: every t-link is 0, but the p1-p2
    # relation and the (trainee-blind) win links still score.
    result = score_blueprint(
        TABLE, None,
        p1=Slot(100, wins=_w(10)),
        p2=Slot(200, wins=_w(10)),
    )
    assert result["relation_total"] == 15  # rel2(100, 200); all t-links 0
    assert result["win_total"] == WIN_POINTS_PER_SHARED_G1
    assert result["total"] == 15 + WIN_POINTS_PER_SHARED_G1
    assert result["p1_affinity"] == 0  # set parent, but no t-links or GP wins
    assert result["p2_affinity"] == 0


def test_shared_wins_score_on_parent_links() -> None:
    result = score_blueprint(
        TABLE, 100,
        p1=Slot(200, wins=_w(10, 15)),
        p2=Slot(300, wins=_w(10)),
        g11=Slot(400, wins=_w(15)),
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
        p1=Slot(200, wins=_w(10)),
        p2=Slot(300),
        g21=Slot(400, wins=_w(10)),
    )
    assert result["win_total"] == 0


def test_duplicate_race_counts_once() -> None:
    # Two saddles covering the same race collapse in g1_wins, so the shared
    # set can't double-count; a shared pair is worth exactly one bonus.
    wins = g1_wins([1, 2], SADDLE_FIXTURE)  # race 10 appears in both saddles
    result = score_blueprint(TABLE, 100, p1=Slot(200, wins=wins), p2=Slot(300, wins=_w(10)))
    assert result["win_total"] == WIN_POINTS_PER_SHARED_G1


# ---------- duplicate-chara exclusions ----------


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
        p1=Slot(200, wins=_w(10)),
        g11=Slot(100, wins=_w(10)),
    )
    assert r["win_total"] == WIN_POINTS_PER_SHARED_G1


def test_parent_repeating_trainee_scores_no_relation() -> None:
    # The game forbids this configuration; the module must not score
    # rel2(x, x) self-affinity for it.
    r = score_blueprint(TABLE, 100, p1=Slot(100), p2=Slot(200))
    by_link = {entry["link"]: entry["relation_points"] for entry in r["links"]}
    assert by_link["t-p1"] == 0
    assert by_link["t-p2"] == 15


def test_same_chara_parents_score_nothing_together() -> None:
    # p1 == p2 is game-rejected: no p1-p2 relation, no p1-p2 win overlap.
    r = score_blueprint(
        TABLE, 100, p1=Slot(200, wins=_w(10)), p2=Slot(200, wins=_w(10))
    )
    by_link = {e["link"]: (e["relation_points"], e["win_points"]) for e in r["links"]}
    assert by_link["p1-p2"] == (0, 0)


def test_duplicate_sibling_grandparent_is_voided() -> None:
    # g12 repeating g11's chara is game-rejected; the duplicate slot must
    # not double-count the triple nor its win overlap.
    single = score_blueprint(TABLE, 100, p1=Slot(200), g11=Slot(300, wins=_w(10)))
    doubled = score_blueprint(
        TABLE, 100,
        p1=Slot(200, wins=_w(10)),
        g11=Slot(300, wins=_w(10)),
        g12=Slot(300, wins=_w(10)),
    )
    assert doubled["relation_total"] == single["relation_total"]
    # Only the g11 win link scores; the duplicate g12 link is void.
    assert doubled["win_total"] == WIN_POINTS_PER_SHARED_G1


# ---------- in-game verified anchors (Global client, 2026-07-30) ----------
# Slot saddle ids come from a real UmaExtractor dump and run through the
# same g1_wins()/SADDLES expansion production will use; expected totals were
# verified against the parent-select symbols in three rounds of checks.


def _real_table() -> RelationTable:
    return build_relation_table(RELATION_POINTS, RELATION_MEMBERS)


def _slot(chara_id: int, saddle_ids: list[int]) -> Slot:
    return Slot(chara_id, wins=g1_wins(saddle_ids, SADDLES))


# Haru Urara's side of several anchors (p2 + its parents).
_HARU = ([30, 37, 81, 118, 120], 1052)
_HARU_G21 = ([2, 7, 10, 11, 12, 15, 17, 18, 21, 22, 23, 25, 26, 27, 33, 49, 64, 66, 80], 1004)
_HARU_G22 = ([1, 10, 11, 12, 16, 17, 18, 26, 34, 43, 79], 1017)


def test_anchor_trainee_in_lineage_triangle() -> None:
    # Trainee Special Week (1001); p1 Taiki Shuttle whose own parent IS
    # Special Week — the exclusion drops this pair to △ (game-confirmed).
    r = score_blueprint(
        _real_table(), 1001,
        p1=_slot(1010, [7, 21, 22, 23, 27, 49, 106]),
        g11=_slot(1001, [2, 5, 10, 11, 13, 15, 34, 82, 140]),
        g12=_slot(1032, [2, 10, 11, 12, 15, 17, 45, 140]),
        p2=_slot(_HARU[1], _HARU[0]),
        g21=_slot(_HARU_G21[1], _HARU_G21[0]),
        g22=_slot(_HARU_G22[1], _HARU_G22[0]),
    )
    assert r["total"] == 47
    assert symbol_for(r["total"], RANKS) == "△"


def test_anchor_circle_with_win_bonus() -> None:
    # Trainee Special Week; Maruzensky x Haru Urara — game-confirmed ○.
    r = score_blueprint(
        _real_table(), 1001,
        p1=_slot(1004, [10, 12, 15, 17, 18, 21, 33, 49, 109]),
        g11=_slot(1024, [1, 2, 5, 6, 10, 11, 12, 13, 14, 15, 16, 18, 26, 34, 48]),
        g12=_slot(1020, [2, 6, 10, 11, 12, 14, 15, 18, 26, 34, 40, 43, 64, 117]),
        p2=_slot(_HARU[1], _HARU[0]),
        g21=_slot(_HARU_G21[1], _HARU_G21[0]),
        g22=_slot(_HARU_G22[1], _HARU_G22[0]),
    )
    assert r["total"] == 71
    assert symbol_for(r["total"], RANKS) == "○"


def test_anchor_double_circle_win_heavy() -> None:
    # Trainee Mayano Top Gun; Smart Falcon x Taiki Shuttle — game-confirmed
    # ◎ with 90 of its points from shared G1 wins.
    r = score_blueprint(
        _real_table(), 1024,
        p1=_slot(
            1046,
            [3, 7, 8, 14, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 32, 33, 34,
             36, 39, 41, 46, 60, 61, 71, 91, 114],
        ),
        g11=_slot(
            1026,
            [1, 2, 4, 5, 6, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21, 25, 26, 27, 33, 49],
        ),
        g12=_slot(
            1020,
            [1, 2, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21, 23, 25, 26,
             27, 34, 35, 42, 43, 46, 49, 61, 64, 85, 126, 130, 132, 137],
        ),
        p2=_slot(
            1010,
            [3, 7, 8, 9, 15, 19, 20, 21, 22, 23, 24, 25, 27, 28, 29, 30, 32, 33,
             34, 39, 41, 45, 46, 69, 82, 102, 124, 128, 130],
        ),
        g21=_slot(1026, [10, 11, 12, 18, 25, 33, 49]),
        g22=_slot(1045, [2, 4, 5, 6, 10, 11, 12, 13, 14, 15, 17, 18, 26, 45, 72]),
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
