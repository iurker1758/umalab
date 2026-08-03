import type { Factor, Veteran } from "./api";
import { writeStore } from "./storage";

// The sparks a "Legacy" search may match: the veteran's own, plus her two
// PARENTS' — never her grandparents'. Breeding from her shifts every slot up
// a generation: she becomes a parent, her parents become the grandparents,
// and her grandparents fall out of the game's 6-slot tree entirely. A spark
// sitting on one of those has no slot, no inspiration roll and no affinity
// term, so it can never be inherited from her — shortlisting her for it is
// shortlisting her for something she can't pass on (DECISIONS.md #31).
export const legacyFactorsOf = (v: Veteran): Factor[] => [
  ...v.factors,
  ...v.lineage.filter((m) => m.relation === "parent").flatMap((m) => m.factors),
];

// ---------- filtering ----------
// OR within a category, AND across categories: each section you touch
// narrows the grid, untouched sections don't filter at all.

// Pink spark chips, grouped like the aptitude display: group label →
// [chip label, factor name in the data].
export const PINK_SPARK_GROUPS: [group: string, chips: [label: string, name: string][]][] = [
  [
    "Track",
    [
      ["Turf", "Turf"],
      ["Dirt", "Dirt"],
    ],
  ],
  [
    "Distance",
    [
      ["Sprint", "Sprint"],
      ["Mile", "Mile"],
      ["Medium", "Medium"],
      ["Long", "Long"],
    ],
  ],
  [
    "Style",
    [
      ["Front", "Front Runner"],
      ["Pace", "Pace Chaser"],
      ["Late", "Late Surger"],
      ["End", "End Closer"],
    ],
  ],
];

export type StarMode = "all" | "2plus" | "3";
export type SparkFilter = { names: string[]; stars: StarMode; legacy: boolean };
// Skill sparks carry their star mode and legacy toggle per selected skill.
export type WhiteFilter = { name: string; stars: StarMode; legacy: boolean };
export type Filters = {
  blue: SparkFilter;
  pink: SparkFilter;
  whites: WhiteFilter[];
  // Every veteran has a unique spark, so "all" means the section is inactive.
  unique: { stars: StarMode; legacy: boolean };
  marks: string[];
  cards: number[];
};

export const defaultFilters: Filters = {
  blue: { names: [], stars: "all", legacy: false },
  pink: { names: [], stars: "all", legacy: false },
  whites: [],
  unique: { stars: "all", legacy: false },
  marks: [],
  cards: [],
};

export const STAR_MODES: StarMode[] = ["all", "2plus", "3"];
export const starModeLabel = (m: StarMode) =>
  m === "all" ? "All" : m === "2plus" ? "2★+" : "3★";

export const FILTER_STORE = "umalab.filters";
// The designer's slot picker persists its own filters, under its own key: the
// two sets stay independent in both directions, so narrowing the list to find
// one mare never touches the roster page you go back to (DECISIONS.md #31).
export const PICKER_FILTER_STORE = "umalab.picker.filters";

const isStarMode = (m: unknown): m is StarMode => STAR_MODES.includes(m as StarMode);
// A persisted spark section must be valid in full — a missing stars/legacy
// field would silently read as "3★ only" downstream (starOk's last arm).
const isSparkFilter = (s: SparkFilter | undefined): s is SparkFilter =>
  s !== undefined &&
  Array.isArray(s.names) &&
  s.names.every((n) => typeof n === "string") &&
  isStarMode(s.stars) &&
  typeof s.legacy === "boolean";

export function loadFilters(store: string = FILTER_STORE): Filters {
  try {
    const raw = localStorage.getItem(store);
    if (raw) {
      const p = JSON.parse(raw) as Filters;
      // Shape check; anything off (incl. older formats) falls back.
      if (
        isSparkFilter(p.blue) &&
        isSparkFilter(p.pink) &&
        isStarMode(p.unique?.stars) &&
        typeof p.unique?.legacy === "boolean" &&
        Array.isArray(p.marks) &&
        p.marks.every((m) => typeof m === "string") &&
        Array.isArray(p.cards) &&
        p.cards.every((c) => typeof c === "number")
      ) {
        return {
          ...defaultFilters,
          ...p,
          // Newer than the base shape and reshaped once — keep only entries
          // matching the current per-skill form.
          whites: Array.isArray(p.whites)
            ? p.whites.filter(
                (w) =>
                  typeof w?.name === "string" &&
                  isStarMode(w?.stars) &&
                  typeof w?.legacy === "boolean"
              )
            : defaultFilters.whites,
        };
      }
    }
  } catch {
    // unreadable storage or garbage value — fall through to the default
  }
  return defaultFilters;
}

// Paired with loadFilters so both ends of a store key sit together — a write
// that skipped the shape the loader validates would read back as defaults.
export function saveFilters(filters: Filters, store: string = FILTER_STORE): void {
  writeStore(store, filters);
}

const starOk = (star: number, mode: StarMode) =>
  mode === "all" ? true : mode === "2plus" ? star >= 2 : star === 3;

// The factor kinds the Common Sparks filter covers.
export const isCommonKind = (kind: string) =>
  kind === "white" || kind === "race" || kind === "scenario";

// Every common-spark (white skill / race / scenario) name a filter can
// actually match — each veteran's own plus her parents', which is the legacy
// pool. A name only a grandparent carries is left out on purpose: nothing can
// match it, and offering it in the chooser is a dead option that reads as "no
// veteran has this".
//
// The chooser's vocabulary and `reconcileFilters`' idea of a still-matchable
// name have to be the SAME set — offering a name reconcile then strips would
// clear a filter the panel had just invited you to pick — so reconcile builds
// its set from this rather than walking the pool a second time.
export const commonSparkNamesOf = (veterans: Veteran[]): string[] => {
  const names = new Set<string>();
  for (const v of veterans) {
    for (const f of legacyFactorsOf(v)) if (isCommonKind(f.kind)) names.add(f.name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
};

export const countFilters = (f: Filters) =>
  f.blue.names.length +
  f.pink.names.length +
  f.whites.length +
  (f.unique.stars !== "all" ? 1 : 0) +
  f.marks.length +
  f.cards.length;

export function matchesFilters(v: Veteran, f: Filters): boolean {
  // "Legacy" widens a spark section's pool to the veteran and her parents
  // (see legacyFactorsOf). Built lazily at most once per veteran — every
  // white-filter row plus the blue/pink/unique sections may all ask for it in
  // one pass.
  let legacyPool: Factor[] | null = null;
  const pool = (legacy: boolean): Factor[] =>
    legacy ? (legacyPool ??= legacyFactorsOf(v)) : v.factors;
  if (
    f.blue.names.length > 0 &&
    !pool(f.blue.legacy).some(
      (fa) =>
        fa.kind === "blue" && f.blue.names.includes(fa.name) && starOk(fa.star, f.blue.stars)
    )
  ) {
    return false;
  }
  if (
    f.pink.names.length > 0 &&
    !pool(f.pink.legacy).some(
      (fa) =>
        fa.kind === "pink" && f.pink.names.includes(fa.name) && starOk(fa.star, f.pink.stars)
    )
  ) {
    return false;
  }
  // Common sparks (white + race + scenario) AND together — a breeding
  // shortlist wants veterans that carry EVERY hunted spark, unlike the OR
  // chips elsewhere.
  if (
    f.whites.length > 0 &&
    !f.whites.every((w) =>
      pool(w.legacy).some(
        (fa) => isCommonKind(fa.kind) && fa.name === w.name && starOk(fa.star, w.stars)
      )
    )
  ) {
    return false;
  }
  if (
    f.unique.stars !== "all" &&
    !pool(f.unique.legacy).some(
      (fa) => fa.kind === "unique" && starOk(fa.star, f.unique.stars)
    )
  ) {
    return false;
  }
  if (f.marks.length > 0 && !f.marks.includes(v.tags[0] ?? "")) return false;
  if (f.cards.length > 0 && !f.cards.includes(v.card_id)) return false;
  return true;
}

// A filter whose target left the roster is cleared, not masked — masking
// would let it reactivate silently when the target returns, and a persisted
// filter could otherwise hide the whole roster with nothing left in the
// panel to explain why. Runs on every roster load (mark edits, re-imports).
export function reconcileFilters(f: Filters, vets: Veteran[]): Filters {
  const marks = new Set<string>([""]); // the no-favorite chip is always valid
  const cards = new Set<number>();
  // The chooser's own vocabulary, so the two can't drift: a name it offers is
  // a name this keeps, and a name it drops is one no filter can match any
  // more — which is what makes clearing that filter right rather than a
  // roster hidden with nothing in the panel to explain why.
  const sparks = new Set(commonSparkNamesOf(vets));
  for (const v of vets) {
    if (v.tags[0]) marks.add(v.tags[0]);
    cards.add(v.card_id);
  }
  const next: Filters = {
    ...f,
    marks: f.marks.filter((m) => marks.has(m)),
    cards: f.cards.filter((c) => cards.has(c)),
    whites: f.whites.filter((w) => sparks.has(w.name)),
  };
  return countFilters(next) === countFilters(f) ? f : next;
}
