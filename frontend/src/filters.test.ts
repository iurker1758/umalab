import { beforeEach, describe, expect, it } from "vitest";
import {
  FILTER_STORE,
  commonSparkNamesOf,
  countFilters,
  defaultFilters,
  legacyFactorsOf,
  loadFilters,
  matchesFilters,
  reconcileFilters,
  saveFilters,
  type Filters,
} from "./filters";
import { factor, member, stubBrokenLocalStorage, stubLocalStorage, veteran } from "./testing";

const withFilters = (over: Partial<Filters>): Filters => ({ ...defaultFilters, ...over });

// A veteran whose own sparks, parents' and grandparents' are each
// distinguishable — the whole point of the legacy pool rule.
const bred = veteran({
  factors: [
    factor({ kind: "blue", key: 1, star: 2, name: "Speed" }),
    factor({ kind: "pink", key: 32, star: 3, name: "Mile" }),
    factor({ kind: "white", key: 700, star: 1, name: "Own Skill" }),
    factor({ kind: "unique", key: 100_101, star: 2, name: "Own Green" }),
  ],
  lineage: [
    member({
      position_id: 10,
      factors: [factor({ kind: "white", key: 701, star: 3, name: "Parent Skill" })],
    }),
    member({
      position_id: 11,
      factors: [factor({ kind: "white", key: 702, star: 3, name: "Grandparent Skill" })],
    }),
  ],
});

describe("legacyFactorsOf", () => {
  it("stops at the parents — a grandparent's spark cannot be inherited from her", () => {
    const names = legacyFactorsOf(bred).map((f) => f.name);
    expect(names).toContain("Own Skill");
    expect(names).toContain("Parent Skill");
    expect(names).not.toContain("Grandparent Skill");
  });

  it("is the veteran's own list when nothing is bred below her", () => {
    const lone = veteran({ factors: [factor({ kind: "white", key: 1, name: "X" })] });
    expect(legacyFactorsOf(lone)).toEqual(lone.factors);
  });
});

describe("commonSparkNamesOf", () => {
  it("offers only names a filter could actually match, sorted", () => {
    expect(commonSparkNamesOf([bred])).toEqual(["Own Skill", "Parent Skill"]);
  });

  it("covers white, race and scenario and nothing else", () => {
    const v = veteran({
      factors: [
        factor({ kind: "race", key: 1, name: "Race" }),
        factor({ kind: "scenario", key: 2, name: "Scenario" }),
        factor({ kind: "blue", key: 3, name: "Speed" }),
        factor({ kind: "pink", key: 4, name: "Mile" }),
        factor({ kind: "unique", key: 5, name: "Green" }),
        factor({ kind: "other", key: 6, name: "Other" }),
      ],
    });
    expect(commonSparkNamesOf([v])).toEqual(["Race", "Scenario"]);
  });
});

describe("matchesFilters", () => {
  it("matches everything when nothing is touched", () => {
    expect(matchesFilters(bred, defaultFilters)).toBe(true);
  });

  it("ORs within a section", () => {
    const f = withFilters({ pink: { names: ["Long", "Mile"], stars: "all", legacy: false } });
    expect(matchesFilters(bred, f)).toBe(true);
    const miss = withFilters({ pink: { names: ["Long"], stars: "all", legacy: false } });
    expect(matchesFilters(bred, miss)).toBe(false);
  });

  it("ANDs across sections", () => {
    const both = withFilters({
      blue: { names: ["Speed"], stars: "all", legacy: false },
      pink: { names: ["Mile"], stars: "all", legacy: false },
    });
    expect(matchesFilters(bred, both)).toBe(true);
    const one = withFilters({
      blue: { names: ["Wit"], stars: "all", legacy: false },
      pink: { names: ["Mile"], stars: "all", legacy: false },
    });
    expect(matchesFilters(bred, one)).toBe(false);
  });

  it("ANDs the common sparks with each other — a shortlist wants every one", () => {
    const f = withFilters({
      whites: [
        { name: "Own Skill", stars: "all", legacy: false },
        { name: "Parent Skill", stars: "all", legacy: true },
      ],
    });
    expect(matchesFilters(bred, f)).toBe(true);
    // The second is a parent's, so without legacy on that row it misses.
    const strict = withFilters({
      whites: [
        { name: "Own Skill", stars: "all", legacy: false },
        { name: "Parent Skill", stars: "all", legacy: false },
      ],
    });
    expect(matchesFilters(bred, strict)).toBe(false);
  });

  it("applies the star mode to the matching spark", () => {
    const at = (stars: "all" | "2plus" | "3") =>
      matchesFilters(bred, withFilters({ blue: { names: ["Speed"], stars, legacy: false } }));
    // The blue is 2★.
    expect(at("all")).toBe(true);
    expect(at("2plus")).toBe(true);
    expect(at("3")).toBe(false);
  });

  it("treats the unique section as inactive at 'all'", () => {
    const noUnique = veteran({ factors: [] });
    expect(matchesFilters(noUnique, withFilters({ unique: { stars: "all", legacy: false } }))).toBe(
      true
    );
    expect(matchesFilters(noUnique, withFilters({ unique: { stars: "3", legacy: false } }))).toBe(
      false
    );
  });

  it("widens a section to the parents when legacy is on, per section", () => {
    const own = withFilters({ whites: [{ name: "Parent Skill", stars: "all", legacy: false }] });
    const legacy = withFilters({ whites: [{ name: "Parent Skill", stars: "all", legacy: true }] });
    expect(matchesFilters(bred, own)).toBe(false);
    expect(matchesFilters(bred, legacy)).toBe(true);
  });

  it("matches a mark on the FIRST tag only", () => {
    const marked = veteran({ tags: ["mark_03", "mark_07"] });
    expect(matchesFilters(marked, withFilters({ marks: ["mark_03"] }))).toBe(true);
    expect(matchesFilters(marked, withFilters({ marks: ["mark_07"] }))).toBe(false);
  });

  it("matches the no-favorite chip on an untagged veteran", () => {
    expect(matchesFilters(veteran({ tags: [] }), withFilters({ marks: [""] }))).toBe(true);
  });

  it("matches on card", () => {
    expect(matchesFilters(bred, withFilters({ cards: [bred.card_id] }))).toBe(true);
    expect(matchesFilters(bred, withFilters({ cards: [999] }))).toBe(false);
  });
});

describe("countFilters", () => {
  it("counts every active chip, and the unique section only when it filters", () => {
    expect(countFilters(defaultFilters)).toBe(0);
    expect(
      countFilters(
        withFilters({
          blue: { names: ["Speed", "Wit"], stars: "all", legacy: false },
          whites: [{ name: "X", stars: "all", legacy: false }],
          unique: { stars: "3", legacy: false },
          marks: ["mark_01"],
          cards: [1, 2],
        })
      )
    ).toBe(7);
  });
});

describe("reconcileFilters", () => {
  const active = withFilters({
    marks: ["mark_03"],
    cards: [bred.card_id],
    whites: [{ name: "Own Skill", stars: "all", legacy: false }],
  });
  const roster = [veteran({ ...bred, tags: ["mark_03"] })];

  it("returns the same object when nothing has left the roster", () => {
    expect(reconcileFilters(active, roster)).toBe(active);
  });

  it("clears a filter whose target is gone rather than masking it", () => {
    const next = reconcileFilters(active, [veteran({ card_id: 999, tags: [] })]);
    expect(next).toEqual(defaultFilters);
    expect(next).not.toBe(active);
  });

  it("keeps the no-favorite chip, which is always valid", () => {
    const f = withFilters({ marks: [""] });
    expect(reconcileFilters(f, [])).toBe(f);
  });

  it("keeps exactly the names the chooser would still offer", () => {
    const offered = commonSparkNamesOf(roster);
    const f = withFilters({
      whites: [
        { name: "Parent Skill", stars: "all", legacy: true },
        { name: "Grandparent Skill", stars: "all", legacy: true },
      ],
    });
    expect(reconcileFilters(f, roster).whites.map((w) => w.name)).toEqual(
      f.whites.map((w) => w.name).filter((n) => offered.includes(n))
    );
  });
});

describe("loadFilters", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = stubLocalStorage();
  });

  it("defaults on an empty store", () => {
    expect(loadFilters()).toEqual(defaultFilters);
  });

  it("round-trips what saveFilters wrote", () => {
    const f = withFilters({
      pink: { names: ["Mile"], stars: "2plus", legacy: true },
      whites: [{ name: "X", stars: "3", legacy: false }],
      marks: ["mark_01"],
      cards: [100_101],
    });
    saveFilters(f);
    expect(loadFilters()).toEqual(f);
  });

  it("keeps the two store keys independent", () => {
    saveFilters(withFilters({ marks: ["mark_01"] }), "umalab.picker.filters");
    expect(loadFilters(FILTER_STORE)).toEqual(defaultFilters);
  });

  it.each([
    ["unparseable JSON", "{not json"],
    ["a non-object", '"nope"'],
    ["a spark section missing its stars", '{"blue":{"names":[],"legacy":false}}'],
    ["a spark section missing its legacy flag", '{"blue":{"names":[],"stars":"all"}}'],
    ["an out-of-range star mode", '{"blue":{"names":[],"stars":"4plus","legacy":false}}'],
    ["a mark list of numbers", '{"marks":[1]}'],
  ])("falls back to the defaults on %s", (_what, raw) => {
    store.set(FILTER_STORE, raw);
    expect(loadFilters()).toEqual(defaultFilters);
  });

  it("drops only the malformed entries from an otherwise valid whites list", () => {
    const f = withFilters({ whites: [{ name: "Keep", stars: "all", legacy: false }] });
    saveFilters(f);
    const raw = JSON.parse(store.get(FILTER_STORE)!) as Filters;
    raw.whites.push({ name: "Drop" } as never);
    store.set(FILTER_STORE, JSON.stringify(raw));
    expect(loadFilters().whites).toEqual(f.whites);
  });

  it("survives storage that throws on every read", () => {
    stubBrokenLocalStorage();
    expect(loadFilters()).toEqual(defaultFilters);
  });

  it("survives storage that throws on every write", () => {
    stubBrokenLocalStorage();
    expect(() => saveFilters(defaultFilters)).not.toThrow();
  });
});
