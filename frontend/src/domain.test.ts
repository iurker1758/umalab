import { beforeEach, describe, expect, it } from "vitest";
import {
  BLUE_ORDER,
  LETTER_ORDER,
  MARK_IDS,
  SORT_STORE,
  apt,
  blueSparkRank,
  charaPlaceholder,
  gradeClass,
  isCharaPlaceholder,
  isLetter,
  loadSortPref,
  markLabel,
  rankTier,
  rosterCardsOf,
  saveSortPref,
  sortVeterans,
  sparkAbbr,
  statGrade,
  type SortPref,
} from "./domain";
import { factor, member, stubBrokenLocalStorage, stubLocalStorage, veteran } from "./testing";

describe("apt", () => {
  it("maps the game's 1..8 scale onto G..S", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(apt).join("")).toBe("GFEDCBAS");
  });

  it("says '-' for no value and '?' for anything off the scale", () => {
    expect(apt(0)).toBe("-");
    expect(apt(9)).toBe("?");
    expect(apt(-1)).toBe("?");
  });

  it("gates pinks at 7 = A, which is the verified rule", () => {
    expect(apt(7)).toBe("A");
    expect(LETTER_ORDER.indexOf("A")).toBe(6);
  });
});

describe("isLetter", () => {
  it("accepts the eight grades and nothing else", () => {
    expect(LETTER_ORDER.every(isLetter)).toBe(true);
    for (const junk of ["-", "?", "", "AA", 7, null, undefined]) {
      expect(isLetter(junk)).toBe(false);
    }
  });
});

describe("statGrade", () => {
  // The in-game anchors named in the source, plus both sides of the SS+/UG
  // boundary that the uncap ladder hangs off.
  it.each([
    [1200, "SS+"],
    [1201, "UG"],
    [1317, "UF"],
    [1613, "UC"],
    [1110, "SS"],
    [612, "B"],
    [488, "C"],
    [50, "G+"],
    [49, "G"],
    [0, "G"],
  ])("%i grades as %s", (n, grade) => {
    expect(statGrade(n)).toBe(grade);
  });

  it("degrades a negative stat to G rather than undefined", () => {
    expect(statGrade(-5)).toBe("G");
  });
});

describe("rankTier", () => {
  it.each([
    [19_200, "SS+"],
    [19_600, "UG"],
    [19_599, "SS+"],
    [10_000, "A"],
    [0, "G"],
    [-1, "G"],
  ])("%i is tier %s", (score, tier) => {
    expect(rankTier(score)).toBe(tier);
  });
});

describe("gradeClass", () => {
  it("keys off the first letter, so SS+ and S share a family", () => {
    expect(gradeClass("SS+")).toBe("ltr-s");
    expect(gradeClass("S")).toBe("ltr-s");
    expect(gradeClass("UC")).toBe("ltr-u");
  });

  it("is empty for anything outside the palette", () => {
    expect(gradeClass("?")).toBe("");
    expect(gradeClass("-")).toBe("");
  });

  // "" used to pass the palette check — every string contains the empty
  // string — and then throw dereferencing the character it had just found
  // wasn't there. Found by this port.
  it("is empty, not a crash, for a letter that isn't there at all", () => {
    expect(gradeClass("")).toBe("");
  });
});

describe("blueSparkRank", () => {
  const withBlue = (name: string, star: number) =>
    veteran({ factors: [factor({ kind: "blue", key: 1, star, name })] });

  it("orders by stat in game order, then star within it", () => {
    expect(blueSparkRank(withBlue("Speed", 1))).toBe(0);
    expect(blueSparkRank(withBlue("Speed", 3))).toBe(2);
    expect(blueSparkRank(withBlue("Stamina", 1))).toBe(3);
    expect(blueSparkRank(withBlue("Wit", 3))).toBe(BLUE_ORDER.length * 3 - 1);
  });

  it("sorts a veteran with no blue, and one with an unrecognised stat, first", () => {
    expect(blueSparkRank(veteran({ factors: [] }))).toBe(-1);
    expect(blueSparkRank(withBlue("Cunning", 3))).toBe(-1);
  });

  it("reads her OWN blue, never a parent's", () => {
    const v = withBlue("Speed", 1);
    v.lineage = [
      member({ position_id: 10, factors: [factor({ kind: "blue", key: 1, star: 3, name: "Wit" })] }),
    ];
    expect(blueSparkRank(v)).toBe(0);
  });
});

describe("sortVeterans", () => {
  const a = veteran({ id: 1, name: "Ann", rank_score: 100, register_time: "2026-01-01T00:00:00" });
  const b = veteran({ id: 2, name: "Bea", rank_score: 300, register_time: "2026-03-01T00:00:00" });
  const c = veteran({ id: 3, name: "Cal", rank_score: 200, register_time: "2026-02-01T00:00:00" });
  const roster = [a, b, c];
  const ids = (sort: SortPref) => sortVeterans(roster, sort).map((v) => v.id);

  it("sorts a copy, never in place", () => {
    const before = roster.map((v) => v.id);
    sortVeterans(roster, { key: "rank_score", asc: false });
    expect(roster.map((v) => v.id)).toEqual(before);
  });

  it("orders by rating in both directions", () => {
    expect(ids({ key: "rank_score", asc: false })).toEqual([2, 3, 1]);
    expect(ids({ key: "rank_score", asc: true })).toEqual([1, 3, 2]);
  });

  it("orders ISO register_time as a date, by string compare", () => {
    expect(ids({ key: "register_time", asc: false })).toEqual([2, 3, 1]);
  });

  it("orders by name", () => {
    expect(ids({ key: "name", asc: true })).toEqual([1, 2, 3]);
  });

  it("routes blue_spark through the rank rather than the missing field", () => {
    const sparked = [
      veteran({ id: 1, factors: [factor({ kind: "blue", key: 1, star: 3, name: "Wit" })] }),
      veteran({ id: 2, factors: [factor({ kind: "blue", key: 1, star: 1, name: "Speed" })] }),
    ];
    expect(sortVeterans(sparked, { key: "blue_spark", asc: true }).map((v) => v.id)).toEqual([2, 1]);
  });
});

describe("rosterCardsOf", () => {
  it("keeps one entry per card, sorted by name then card", () => {
    const roster = [
      veteran({ id: 1, card_id: 200, name: "Zed" }),
      veteran({ id: 2, card_id: 100, name: "Ann" }),
      veteran({ id: 3, card_id: 200, name: "Zed" }),
      veteran({ id: 4, card_id: 150, name: "Ann" }),
    ];
    expect(rosterCardsOf(roster).map((v) => v.card_id)).toEqual([100, 150, 200]);
  });

  it("keeps the FIRST veteran on a card, which is the one the roster shows", () => {
    const roster = [veteran({ id: 1, card_id: 1 }), veteran({ id: 2, card_id: 1 })];
    expect(rosterCardsOf(roster).map((v) => v.id)).toEqual([1]);
  });
});

describe("names that degrade", () => {
  it("recognises its own chara placeholder and nothing else", () => {
    expect(isCharaPlaceholder(charaPlaceholder(1042))).toBe(true);
    expect(isCharaPlaceholder("Chara")).toBe(false);
    expect(isCharaPlaceholder("Chara 10a")).toBe(false);
    expect(isCharaPlaceholder("Special Week")).toBe(false);
    expect(isCharaPlaceholder(null)).toBe(false);
  });

  it("abbreviates a known spark and clips an unknown one", () => {
    expect(sparkAbbr("Medium")).toBe("MED");
    expect(sparkAbbr("Front Runner")).toBe("FRONT");
    expect(sparkAbbr("Something New")).toBe("SOMET");
  });

  it("labels every mark id, and numbers one it doesn't know", () => {
    expect(MARK_IDS).toHaveLength(15);
    expect(MARK_IDS.every((id) => !markLabel(id).startsWith("Mark "))).toBe(true);
    expect(markLabel("mark_99")).toBe("Mark 99");
  });
});

describe("loadSortPref", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = stubLocalStorage();
  });

  it("defaults to newest first", () => {
    expect(loadSortPref()).toEqual({ key: "register_time", asc: false });
  });

  it("round-trips what saveSortPref wrote", () => {
    saveSortPref({ key: "name", asc: true });
    expect(loadSortPref()).toEqual({ key: "name", asc: true });
  });

  it("keeps the picker's key independent of the roster's", () => {
    saveSortPref({ key: "name", asc: true }, "umalab.picker.sort");
    expect(loadSortPref(SORT_STORE)).toEqual({ key: "register_time", asc: false });
  });

  it.each([
    ["unparseable JSON", "{not json"],
    ["an unknown sort key", '{"key":"fans","asc":true}'],
    ["a missing direction", '{"key":"name"}'],
    ["a direction that isn't a boolean", '{"key":"name","asc":"yes"}'],
    ["a bare number", "7"],
  ])("falls back to the default on %s", (_what, raw) => {
    store.set(SORT_STORE, raw);
    expect(loadSortPref()).toEqual({ key: "register_time", asc: false });
  });

  it("survives storage that throws", () => {
    stubBrokenLocalStorage();
    expect(loadSortPref()).toEqual({ key: "register_time", asc: false });
    expect(() => saveSortPref({ key: "name", asc: true })).not.toThrow();
  });
});
