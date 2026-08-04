import { describe, expect, it } from "vitest";
import {
  aptitudeRows,
  bracketBump,
  letterModeOf,
  undroppableSpark,
  windowStars,
} from "./aptitude";
import { catalogSlot } from "./blueprint";
import type { AptitudeKey, AptitudeLetters, PinkSpark } from "./api";
import { designWith, slot } from "./testing";

// Ten letters is the whole set, and every test wants a different one or two of
// them, so build from a base and override.
const letters = (over: Partial<AptitudeLetters> = {}): AptitudeLetters => ({
  turf: "A", dirt: "G", sprint: "G", mile: "C", medium: "B", long: "G",
  front: "G", pace: "G", late: "G", end: "G",
  ...over,
});

const pink = (aptitude: AptitudeKey, stars: number): PinkSpark => ({ aptitude, stars });

const rowFor = (rows: ReturnType<typeof aptitudeRows>, key: AptitudeKey) =>
  rows.find((r) => r.key === key)!;

describe("bracketBump", () => {
  // The verified thresholds: 1/4/7/10. Both sides of every one of them.
  it.each([
    [0, 0],
    [1, 1],
    [3, 1],
    [4, 2],
    [6, 2],
    [7, 3],
    [9, 3],
    [10, 4],
    [11, 4],
    [99, 4],
  ])("%i★ is worth +%i", (stars, bump) => {
    expect(bracketBump(stars)).toBe(bump);
  });
});

describe("windowStars", () => {
  it("sums matching stars over a node's two generations below it", () => {
    // Parent 1's window is 3, 4 and their kids 7, 8, 9, 10.
    const design = designWith({
      3: catalogSlot(1, 1, pink("mile", 3)),
      4: catalogSlot(2, 2, pink("mile", 2)),
      7: { aptitude: "mile", stars: 1 },
      8: { aptitude: "turf", stars: 3 },
      // Outside Parent 1's window — Parent 2's side.
      5: catalogSlot(3, 3, pink("mile", 3)),
    });
    const stars = windowStars(design, 1);
    expect(stars.get("mile")).toBe(6);
    expect(stars.get("turf")).toBe(3);
    expect(stars.get("long")).toBeUndefined();
  });

  it("is empty for a generation-4 node, which has nothing below it", () => {
    const design = designWith({ 15: { aptitude: "turf", stars: 3 } });
    expect(windowStars(design, 15).size).toBe(0);
  });

  it("ignores a deep slot holding only a character", () => {
    const design = designWith({ 3: { card_id: 100_101 } });
    expect(windowStars(design, 1).size).toBe(0);
  });
});

describe("aptitudeRows, projecting", () => {
  // Mile is C in the fixture; four stars is +2, so C → A.
  const design = designWith({
    3: catalogSlot(1, 1, pink("mile", 3)),
    4: catalogSlot(2, 2, pink("mile", 1)),
  });

  it("applies the bracket to the card's base", () => {
    const mile = rowFor(aptitudeRows(design, 1, letters()), "mile");
    expect(mile).toMatchObject({ base: "C", final: "A", stars: 4, bump: 2, boosted: true });
  });

  it("caps at A", () => {
    // Medium is B, one below A, and nothing in the window matches it — so the
    // cap is exercised by giving the window enough stars to overshoot.
    const heavy = designWith({
      3: catalogSlot(1, 1, pink("medium", 3)),
      4: catalogSlot(2, 2, pink("medium", 3)),
      7: { aptitude: "medium", stars: 3 },
      8: { aptitude: "medium", stars: 3 },
    });
    const medium = rowFor(aptitudeRows(heavy, 1, letters()), "medium");
    expect(medium).toMatchObject({ base: "B", final: "A", stars: 12, bump: 4, boosted: true });
  });

  it("leaves a base already past the cap alone", () => {
    // capIdx = max(CAP, baseIdx): an S base is not dragged down to A.
    const s = rowFor(aptitudeRows(design, 1, letters({ mile: "S" })), "mile");
    expect(s).toMatchObject({ base: "S", final: "S", bump: 2, boosted: false });
  });

  // Issue #42. This asserts CURRENT behaviour, which is also correct
  // behaviour: `bump` is what the stars are worth and `boosted` is whether
  // the letter moved, and the two disagreeing is exactly the case #42 is
  // about. The bug is in the From column that renders `bump` without
  // consulting `boosted` (AptitudeTable.tsx), not in this arithmetic — so
  // fixing #42 must leave this test passing unchanged.
  it("reports a bump that bought nothing as bump > 0 with boosted false (#42)", () => {
    const turf = rowFor(aptitudeRows(design, 1, letters({ mile: "A" })), "mile");
    expect(turf.bump).toBe(2);
    expect(turf.boosted).toBe(false);
    expect(turf.final).toBe("A");
  });

  it("passes an unrecognised base letter through without claiming a boost", () => {
    const row = rowFor(aptitudeRows(design, 1, letters({ mile: "Z" })), "mile");
    expect(row).toMatchObject({ base: "Z", final: "Z", boosted: false });
  });

  it("has no final letter when the card's letters are unknown", () => {
    const row = rowFor(aptitudeRows(design, 1, null), "mile");
    expect(row).toMatchObject({ base: null, final: null, boosted: false, stars: 4, bump: 2 });
  });
});

describe("aptitudeRows, trained", () => {
  const design = designWith({ 3: catalogSlot(1, 1, pink("mile", 3)) });
  const trained = letters({ mile: "A", medium: "B" });

  it("takes the veteran's own letters and never runs the brackets", () => {
    const rows = aptitudeRows(design, 1, letters(), "trained", trained);
    expect(rowFor(rows, "mile")).toMatchObject({
      base: "C",
      final: "A",
      boosted: true,
      stars: 0,
      bump: 0,
      mode: "trained",
    });
  });

  it("does not call it a boost when she finished where her card started", () => {
    const rows = aptitudeRows(design, 1, letters(), "trained", trained);
    expect(rowFor(rows, "medium").boosted).toBe(false);
  });

  it("does not call it a boost when the card's base is unrecognisable", () => {
    const rows = aptitudeRows(design, 1, letters({ mile: "Z" }), "trained", trained);
    expect(rowFor(rows, "mile")).toMatchObject({ base: "Z", final: "A", boosted: false });
  });

  it("falls through to the projection when the trained letters are missing", () => {
    const rows = aptitudeRows(design, 1, letters(), "trained", null);
    expect(rowFor(rows, "mile")).toMatchObject({ mode: "project", stars: 3 });
  });
});

describe("aptitudeRows, base", () => {
  it("states the card and adds nothing", () => {
    const design = designWith({ 3: catalogSlot(1, 1, pink("mile", 3)) });
    const rows = aptitudeRows(design, 1, letters(), "base");
    expect(rowFor(rows, "mile")).toMatchObject({
      base: "C",
      final: "C",
      boosted: false,
      stars: 0,
      bump: 0,
      mode: "base",
    });
  });
});

describe("letterModeOf", () => {
  it.each([
    ["an empty node", null, "project"],
    ["a catalog pick", slot({ source: "catalog" }), "project"],
    ["a roster pick with her letters", slot({ source: "roster", aptitudes: letters() }), "trained"],
    ["a roster pick missing them", slot({ source: "roster" }), "base"],
    ["a lineage member", slot({ source: "lineage" }), "base"],
  ])("%s projects as %s", (_what, value, mode) => {
    expect(letterModeOf(value)).toBe(mode);
  });
});

describe("undroppableSpark", () => {
  // A 1★ mile pink on Parent 1, whose own window is empty — so mile resolves
  // at the card's C, two below A, and the game could never have dropped it.
  const flagged = designWith({ 1: catalogSlot(1, 1, pink("mile", 1)) });
  const rowsFor = (design: ReturnType<typeof designWith>, i: number) =>
    aptitudeRows(design, i, letters());

  it("flags a planned pink below A on a catalog node", () => {
    expect(undroppableSpark(rowsFor(flagged, 1), flagged, 1)).toBe(true);
  });

  it("does not flag one whose aptitude resolves at A", () => {
    const ok = designWith({ 1: catalogSlot(1, 1, pink("turf", 1)) });
    expect(undroppableSpark(rowsFor(ok, 1), ok, 1)).toBe(false);
  });

  it("never flags a pink that a real dump produced", () => {
    for (const source of ["roster", "lineage"] as const) {
      const pulled = designWith({ 1: slot({ source, spark: pink("mile", 1) }) });
      expect(undroppableSpark(rowsFor(pulled, 1), pulled, 1)).toBe(false);
    }
  });

  it("never flags the trainee or a deep slot", () => {
    expect(undroppableSpark(rowsFor(flagged, 0), flagged, 0)).toBe(false);
    const deep = designWith({ 7: { aptitude: "mile", stars: 1 } });
    expect(undroppableSpark(rowsFor(deep, 7), deep, 7)).toBe(false);
  });

  it("says nothing when the card's letters are unknown", () => {
    const rows = aptitudeRows(flagged, 1, null);
    expect(undroppableSpark(rows, flagged, 1)).toBe(false);
  });
});
