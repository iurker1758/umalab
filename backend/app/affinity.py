"""Inheritance affinity math — pure functions, no I/O, no ORM imports.

Affinity is chara-level (outfits share it) and sums relation points over the
game's succession relation groups: rel2(a, b) counts groups containing both
charas, rel3(a, b, c) groups containing all three. For a blueprint with
trainee T, parents P1/P2, and each parent's parents G11/G12/G21/G22:

    total = rel2(T,P1) + rel2(T,P2) + rel2(P1,P2)
          + rel3(T,P1,G11) + rel3(T,P1,G12)
          + rel3(T,P2,G21) + rel3(T,P2,G22)
          + win bonus

with one non-obvious exclusion, verified against the live Global client
across ten in-game symbol checks (2026-07-30) and confirmed by GameTora's
per-server implementation: a grandparent slot occupied by the same chara as
the TRAINEE (or as its own parent) contributes zero to its triple. Without
this rule every blueprint that reuses the trainee's character in the lineage
overcounts.

The win bonus models the Global system live since 2026-06-24: +3 points per
shared won G1 race on the p1-p2 link and each parent-own-grandparent link
(G2/G3 wins and win titles no longer count; the trainee has no wins at
design time). Wins arrive as won saddle ids from a dump and are expanded to
G1 race-id sets via the races reference, so composite saddles (Triple Crown)
overlap correctly with their component races, and venue variants of the
same G1 (alt-track reroutes, rotating JBC hosts) arrive pre-canonicalized
to one id — the game matches wins across venues (two cross-venue in-game
checks both scored the bonus, 2026-07-30). Win overlaps are NOT subject to
the chara exclusion — a slot's races count even when its chara duplicates
the trainee's.

The per-parent `p1_affinity` / `p2_affinity` fields are the individual
affinities the spark-scoring milestone plugs into
`base_rate * (1 + affinity / 100)`.

Algorithm structure adapted from hakuraku's VeteransHelper.ts (MIT — see
README credits); its legacy win constants are deliberately not ported.

Reference mappings (points, members, saddles, ranks) are passed in so tests
can use synthetic fixtures, mirroring ingest.py.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import NewType, TypedDict

from .reference import RankBand, SaddleInfo

WIN_POINTS_PER_SHARED_G1 = 3

# Won G1 races as CANONICAL race ids — the output of g1_wins(), never raw
# saddle ids. The distinct type keeps a caller from wiring a dump's
# win_saddle_id_array straight into a Slot: both are int sets, but saddle ids
# intersected as race ids score garbage in both directions.
WinSet = NewType("WinSet", frozenset[int])
EMPTY_WINS = WinSet(frozenset())

# Relation links scored from the group tables, and win links scored from
# shared G1s. Cross-family links (e.g. p1 with p2's parents) never score.
RELATION_LINKS = ("t-p1", "t-p2", "p1-p2", "t-p1-g11", "t-p1-g12", "t-p2-g21", "t-p2-g22")
WIN_LINKS = ("p1-p2", "p1-g11", "p1-g12", "p2-g21", "p2-g22")


@dataclass(frozen=True)
class RelationTable:
    """Inverted member table: chara -> the relation groups it belongs to."""

    points: dict[int, int]
    chara_relations: dict[int, frozenset[int]]


@dataclass(frozen=True)
class Slot:
    """One filled blueprint slot: a chara plus its won G1 races (a WinSet
    from g1_wins(); empty for catalog/theoretical picks)."""

    chara_id: int
    wins: WinSet = EMPTY_WINS


class LinkScore(TypedDict):
    link: str
    relation_points: int
    win_points: int


class AffinityResult(TypedDict):
    total: int
    relation_total: int
    win_total: int
    links: list[LinkScore]
    # Individual affinity per parent (None while that parent is unset):
    # rel2(T,P) + rel3(T,P,each GP) + that parent's win links.
    p1_affinity: int | None
    p2_affinity: int | None


def build_relation_table(
    points: dict[int, int], members: dict[int, list[int]]
) -> RelationTable:
    chara_relations: dict[int, set[int]] = {}
    for relation_type, chara_ids in members.items():
        for chara_id in chara_ids:
            chara_relations.setdefault(chara_id, set()).add(relation_type)
    return RelationTable(
        points=dict(points),
        chara_relations={cid: frozenset(rts) for cid, rts in chara_relations.items()},
    )


def _relations_of(table: RelationTable, chara_id: int) -> frozenset[int]:
    # A chara in no group (or unknown entirely) simply scores 0 everywhere.
    return table.chara_relations.get(chara_id, frozenset())


def rel2(table: RelationTable, a: int, b: int) -> int:
    # A chara never scores affinity with itself — without this, a duplicate
    # slot would sum every group the chara belongs to.
    if a == b:
        return 0
    shared = _relations_of(table, a) & _relations_of(table, b)
    return sum(table.points.get(rt, 0) for rt in shared)


def rel3(table: RelationTable, a: int, b: int, c: int) -> int:
    # Any repeated chara zeroes the triple. This includes the in-game
    # verified exclusion (a grandparent repeating the trainee or its own
    # parent; see module docstring) as the c == a / c == b cases.
    if len({a, b, c}) < 3:
        return 0
    shared = _relations_of(table, a) & _relations_of(table, b) & _relations_of(table, c)
    return sum(table.points.get(rt, 0) for rt in shared)


def g1_wins(saddle_ids: list[int], saddles: dict[int, SaddleInfo]) -> WinSet:
    """Expand won saddles to the set of won G1 race ids.

    The union makes composite saddles safe: holding both "Classic Triple
    Crown" and its component races counts each race once. Unknown saddle
    ids (newer game data than the reference) are ignored.
    """
    won: set[int] = set()
    for saddle_id in saddle_ids:
        info = saddles.get(saddle_id)
        if info is not None:
            won.update(info["g1_race_ids"])
    return WinSet(frozenset(won))


def symbol_for(total: int, ranks: list[RankBand]) -> str:
    """First band whose max covers the total; above every band, the last
    symbol (the game's rank table tops out at 9999)."""
    for band in ranks:
        if total <= band["max"]:
            return band["symbol"]
    return ranks[-1]["symbol"] if ranks else "?"


def score_blueprint(
    table: RelationTable,
    trainee: int | None,
    p1: Slot | None = None,
    p2: Slot | None = None,
    g11: Slot | None = None,
    g12: Slot | None = None,
    g21: Slot | None = None,
    g22: Slot | None = None,
) -> AffinityResult:
    """Score a (possibly partial) blueprint. Unset slots — the trainee
    included — contribute 0, so the designer can show a live score while
    slots are being filled; without a trainee the parent-parent relation
    and the (trainee-independent) win links still score.

    Configurations the game outright rejects score nothing rather than
    garbage: same-chara pair links dedupe to 0 (rel2), a grandparent
    repeating its SIBLING slot is voided entirely (relations and wins), and
    a same-chara p1/p2 pair scores no win overlap. The one LEGAL duplicate —
    a grandparent repeating the trainee or its own parent — keeps its wins
    (chara-blind, in-game verified) and loses only its relation triple
    (rel3 dedupes it)."""
    slots: dict[str, Slot | None] = {
        "p1": p1, "p2": p2, "g11": g11, "g12": g12, "g21": g21, "g22": g22,
    }

    def chara(slot_id: str) -> int | None:
        slot = slots[slot_id]
        return slot.chara_id if slot is not None else None

    def repeats_sibling(gp_id: str, sibling_id: str) -> bool:
        gp, sibling = slots[gp_id], slots[sibling_id]
        return gp is not None and sibling is not None and gp.chara_id == sibling.chara_id

    void_slots = {
        gp for gp, sibling in (("g12", "g11"), ("g22", "g21"))
        if repeats_sibling(gp, sibling)
    }

    def relation_points(link: str) -> int:
        parts = link.split("-")
        if parts[-1] in void_slots:
            return 0
        charas: list[int] = []
        for part in parts:
            resolved = trainee if part == "t" else chara(part)
            if resolved is None:
                return 0
            charas.append(resolved)
        if len(charas) == 2:
            return rel2(table, charas[0], charas[1])
        return rel3(table, charas[0], charas[1], charas[2])

    def win_points_for(link: str) -> int:
        a_id, b_id = link.split("-")
        if b_id in void_slots:
            return 0
        a, b = slots[a_id], slots[b_id]
        if a is None or b is None:
            return 0
        if link == "p1-p2" and a.chara_id == b.chara_id:
            return 0
        return WIN_POINTS_PER_SHARED_G1 * len(a.wins & b.wins)

    win_by_link = {link: win_points_for(link) for link in WIN_LINKS}

    links: list[LinkScore] = []
    for link in RELATION_LINKS:
        # Win points ride on the matching pair link (p1-p2) or fold into the
        # parent-grandparent triple link so the UI shows one number per edge.
        win_key = link.removeprefix("t-") if link != "p1-p2" else link
        links.append(
            {
                "link": link,
                "relation_points": relation_points(link),
                "win_points": win_by_link.get(win_key, 0),
            }
        )

    relation_total = sum(entry["relation_points"] for entry in links)
    win_total = sum(win_by_link.values())

    def parent_affinity(parent: str, gps: tuple[str, str]) -> int | None:
        # p1-p2 shared wins are excluded here pending in-game verification of
        # whether they attribute to individual affinity (DECISIONS.md #15);
        # the per-link table above makes reassignment a one-line change.
        if slots[parent] is None:
            return None
        rel = relation_points(f"t-{parent}") + sum(
            relation_points(f"t-{parent}-{gp}") for gp in gps
        )
        wins = sum(win_by_link[f"{parent}-{gp}"] for gp in gps)
        return rel + wins

    return {
        "total": relation_total + win_total,
        "relation_total": relation_total,
        "win_total": win_total,
        "links": links,
        "p1_affinity": parent_affinity("p1", ("g11", "g12")),
        "p2_affinity": parent_affinity("p2", ("g21", "g22")),
    }
