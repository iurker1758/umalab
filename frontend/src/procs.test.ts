import { describe, expect, it } from "vitest";
import {
  SPARK_BASE,
  SPARK_TYPE_ORDER,
  combineOutlooks,
  eventChance,
  formatChance,
  listRows,
  memberSparks,
  runChance,
  sortSparks,
  sparkId,
  type SparkChance,
  type SparkOutlook,
  type SparkRef,
} from "./procs";
import type { SlotFactor } from "./api";

// The published measurement, restated independently of the module so a
// silent edit to SPARK_BASE fails here rather than quietly re-rating every
// design in the app (DECISIONS.md #30).
const MEASURED: Record<string, [number, number, number]> = {
  blue: [70, 80, 90],
  pink: [1, 3, 5],
  white: [3, 6, 9],
  unique: [5, 10, 15],
  race: [1, 2, 3],
  scenario: [3, 6, 9],
};

// The model, written out the way #30 states it, as the check on the code
// rather than a second copy of it: one event is min(base × (1 + aff/100),
// 100), and a run is two of them.
const expected = (type: keyof typeof SPARK_BASE, stars: number, aff: number) => {
  const p = Math.min(MEASURED[type][stars - 1] * (1 + aff / 100), 100) / 100;
  return (1 - (1 - p) ** 2) * 100;
};

describe("SPARK_BASE", () => {
  it("holds the measured rates, and only the kinds the document has", () => {
    expect(SPARK_BASE).toEqual(MEASURED);
  });

  it("groups blue → pink → green → race → white → scenario", () => {
    expect(Object.entries(SPARK_TYPE_ORDER).sort((a, b) => a[1] - b[1]).map(([k]) => k)).toEqual([
      "blue",
      "pink",
      "unique",
      "race",
      "white",
      "scenario",
    ]);
  });
});

describe("eventChance", () => {
  it("scales the base linearly with affinity", () => {
    expect(eventChance("white", 3, 0)).toBeCloseTo(0.09, 10);
    expect(eventChance("white", 3, 100)).toBeCloseTo(0.18, 10);
    expect(eventChance("white", 3, 300)).toBeCloseTo(0.36, 10);
  });

  it("caps at certainty rather than computing past 100%", () => {
    // 9 × (1 + 1000/100) = 99, still under; one more step is over.
    expect(eventChance("white", 3, 1000)).toBeCloseTo(0.99, 10);
    expect(eventChance("white", 3, 1100)).toBe(1);
    expect(eventChance("white", 3, 10_000)).toBe(1);
    // A 3★ blue is over the cap at affinities every real tree reaches.
    expect(eventChance("blue", 3, 12)).toBe(1);
  });

  it("is zero for a star level the scale has no rate for", () => {
    expect(eventChance("pink", 0, 100)).toBe(0);
    expect(eventChance("pink", 4, 100)).toBe(0);
  });
});

describe("runChance", () => {
  it("is 1 − (1−p)² over the two events that vary with compatibility", () => {
    for (const type of ["blue", "pink", "white", "unique", "race", "scenario"] as const) {
      for (const stars of [1, 2, 3]) {
        for (const aff of [0, 37, 150, 300]) {
          expect(runChance(type, stars, aff)).toBeCloseTo(expected(type, stars, aff), 10);
        }
      }
    }
  });

  it("keeps the 1★ pink range wide enough for one decimal", () => {
    // #30's reason for showing one decimal rather than none.
    expect(formatChance(runChance("pink", 1, 0)!)).toBe("2.0%");
    expect(formatChance(runChance("pink", 1, 300)!)).toBe("7.8%");
  });

  it("is null, not zero, when nobody is cast to roll against", () => {
    expect(runChance("pink", 3, null)).toBeNull();
  });
});

describe("sparkId", () => {
  it("keys a pink on its aptitude and everything else on kind and key", () => {
    expect(sparkId({ type: "pink", aptitude: "mile" })).toBe("pink:mile");
    expect(sparkId({ type: "white", key: 12 })).toBe("white:12");
  });

  it("keeps the kinds apart, which number their keys independently", () => {
    expect(sparkId({ type: "white", key: 12 })).not.toBe(sparkId({ type: "race", key: 12 }));
  });
});

describe("memberSparks", () => {
  const factors: SlotFactor[] = [
    { kind: "race", key: 5, stars: 3 },
    { kind: "unique", key: 100_101, stars: 1 },
  ];

  it("lists the pink alongside the rest, best chance first", () => {
    const rows = memberSparks({ aptitude: "mile", stars: 3 }, factors, 100);
    // A 3★ pink and a 1★ green are both base 5, so they tie and the id
    // breaks it; the 3★ race is base 3 and sorts below both.
    expect(rows.map(sparkId)).toEqual(["pink:mile", "unique:100101", "race:5"]);
    expect(rows[0].chance).toBeCloseTo(expected("pink", 3, 100), 10);
  });

  it("omits the pink when there isn't one", () => {
    expect(memberSparks(null, factors, 0).map(sparkId)).toEqual(["unique:100101", "race:5"]);
  });

  it("breaks ties on the id so the order survives a re-score", () => {
    // Two whites at the same level tie on chance at any affinity.
    const rows = memberSparks(
      null,
      [
        { kind: "white", key: 20, stars: 2 },
        { kind: "white", key: 3, stars: 2 },
      ],
      50
    );
    expect(rows.map(sparkId)).toEqual(["white:20", "white:3"]);
  });

  it("carries null chances through rather than sinking them to zero", () => {
    const rows = memberSparks({ aptitude: "mile", stars: 3 }, factors, null);
    expect(rows.every((r) => r.chance === null)).toBe(true);
  });
});

describe("combineOutlooks", () => {
  const spark = (ref: SparkRef, stars: number, chance: number | null): SparkChance =>
    ({ ...ref, stars, chance }) as SparkChance;

  it("unions independent carriers rather than adding them", () => {
    const [row] = combineOutlooks([
      { index: 1, sparks: [spark({ type: "white", key: 7 }, 2, 16.7)] },
      { index: 3, sparks: [spark({ type: "white", key: 7 }, 3, 16.7)] },
    ]);
    expect(row.chance).toBeCloseTo(30.6111, 3);
    expect(row.chance).not.toBeCloseTo(33.4, 1);
  });

  it("lists every carrier in tree order and drops the star level", () => {
    const [row] = combineOutlooks([
      { index: 4, sparks: [spark({ type: "white", key: 7 }, 1, 10)] },
      { index: 1, sparks: [spark({ type: "white", key: 7 }, 3, 10)] },
    ]);
    expect(row.from).toEqual([4, 1]);
    expect(row).not.toHaveProperty("stars");
  });

  it("leaves an unknown carrier out of the product but keeps her in the row", () => {
    const [row] = combineOutlooks([
      { index: 1, sparks: [spark({ type: "pink", aptitude: "mile" }, 3, 20)] },
      { index: 2, sparks: [spark({ type: "pink", aptitude: "mile" }, 3, null)] },
    ]);
    expect(row.from).toEqual([1, 2]);
    expect(row.chance).toBe(20);
  });

  it("stays null when no carrier can be estimated at all", () => {
    const [row] = combineOutlooks([
      { index: 1, sparks: [spark({ type: "race", key: 9 }, 1, null)] },
      { index: 2, sparks: [spark({ type: "race", key: 9 }, 2, null)] },
    ]);
    expect(row.chance).toBeNull();
  });

  it("ranks the roll-up, best first", () => {
    const rows = combineOutlooks([
      {
        index: 1,
        sparks: [
          spark({ type: "race", key: 9 }, 1, 4),
          spark({ type: "white", key: 7 }, 3, 40),
          spark({ type: "unique", key: 5 }, 2, 12),
        ],
      },
    ]);
    expect(rows.map(sparkId)).toEqual(["white:7", "unique:5", "race:9"]);
  });
});

describe("listRows", () => {
  const outlooks: SparkOutlook[] = [
    { type: "white", key: 7, from: [1, 3], chance: 30.6 },
    { type: "race", key: 9, from: [2], chance: null },
  ];

  it("keeps a carried spark's own row intact", () => {
    const [row] = listRows(outlooks, [{ kind: "white", key: 7 }]);
    expect(row).toBe(outlooks[0]);
  });

  it("synthesizes a bare row for a spark nobody holds", () => {
    // The row whose absence a plain highlight could never show — the point
    // of the filtered view while planning (DECISIONS.md #43).
    const [row] = listRows(outlooks, [{ kind: "scenario", key: 40_001 }]);
    expect(row).toEqual({ type: "scenario", key: 40_001, chance: null });
  });

  it("carries a member's stars through, and no stars on a synthesized row", () => {
    // The member tables narrow through this too — their rows keep the ★
    // level, and a spark she doesn't carry has no level to show.
    const rows = listRows(
      [{ type: "white" as const, key: 7, stars: 2, chance: 12.5 }],
      [{ kind: "white", key: 7 }, { kind: "race", key: 9 }]
    );
    expect(rows[0]).toEqual({ type: "white", key: 7, stars: 2, chance: 12.5 });
    expect("stars" in rows[1]).toBe(false);
  });

  it("stays null for a carried spark nobody can estimate", () => {
    const [row] = listRows(outlooks, [{ kind: "race", key: 9 }]);
    expect(row.chance).toBeNull();
  });

  it("keeps the wanted order, one row per want", () => {
    const rows = listRows(outlooks, [
      { kind: "race", key: 9 },
      { kind: "white", key: 7 },
    ]);
    expect(rows.map(sparkId)).toEqual(["race:9", "white:7"]);
  });

  it("sorts under sortSparks with the — rows last", () => {
    // The property the tables rely on: filtering never lets an unanswerable
    // row rank above a real chance.
    const rows = listRows(outlooks, [
      { kind: "race", key: 9 },
      { kind: "scenario", key: 40_001 },
      { kind: "white", key: 7 },
    ]);
    expect(sortSparks(rows, "chance").map(sparkId)).toEqual([
      "white:7",
      "race:9",
      "scenario:40001",
    ]);
  });
});

describe("sortSparks", () => {
  const rows = [
    { type: "scenario" as const, key: 1, chance: 90 },
    { type: "white" as const, key: 2, chance: 50 },
    { type: "pink" as const, aptitude: "mile" as const, chance: 5 },
    { type: "race" as const, key: 3, chance: 70 },
  ];

  it("ranks by chance", () => {
    expect(sortSparks(rows, "chance").map(sparkId)).toEqual([
      "scenario:1",
      "race:3",
      "white:2",
      "pink:mile",
    ]);
  });

  it("groups by kind first, and ranks inside the group", () => {
    expect(sortSparks(rows, "kind").map(sparkId)).toEqual([
      "pink:mile",
      "race:3",
      "white:2",
      "scenario:1",
    ]);
  });

  it("copies rather than sorting in place", () => {
    const before = rows.map(sparkId);
    sortSparks(rows, "kind");
    expect(rows.map(sparkId)).toEqual(before);
  });

  it("sinks an unknown chance below every real one", () => {
    const withNull = [...rows, { type: "white" as const, key: 99, chance: null }];
    expect(sortSparks(withNull, "chance").at(-1)!.key).toBe(99);
  });
});

describe("formatChance", () => {
  it("shows one decimal, always", () => {
    expect(formatChance(0)).toBe("0.0%");
    expect(formatChance(30.61111)).toBe("30.6%");
    expect(formatChance(100)).toBe("100.0%");
  });
});
