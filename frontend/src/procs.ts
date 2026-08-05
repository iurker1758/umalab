import {
  LIST_SPARK_KINDS,
  type AptitudeKey,
  type ListSparkKind,
  type PinkSpark,
  type SlotFactor,
  type SlotFactorKind,
} from "./api";

// ---------- inspiration proc estimates ----------
// What an ancestor's sparks are worth to the TRAINEE: the chance each one is
// inherited during the run, which is what an inspiration proc off that member
// actually is. Distinct from the deterministic career-start bracket in
// aptitude.ts, which applies a pink's letters whether anything procs or not:
//
//   aptitude.ts — every pink in a node's window bumps its letters at career
//                 start, always, capped at A. Certain.
//   here        — during the run, an inspiration may fire off one lineage
//                 member and pass her spark on, which for a pink is the only
//                 route past A to S. Probabilistic, and the chance scales
//                 with that member's affinity.
//
// Every number this module produces is an ESTIMATE and has to be labelled
// one. The Global client's master.mdb carries no proc-rate table anywhere
// (all 416 checked during 7b), so unlike the affinity bands and the bracket
// thresholds this can never be anchored in game data — the conversion is
// server-side. What we have is one published measurement study and one
// independent implementation that agree, which is good enough to show and
// not good enough to state as fact. See DECISIONS.md #29/#30.

// Base per-event chance by ★, before affinity. Measured (Polaris's
// compatibility-0 study, cross-checked against uma.moe's implementation —
// RESOURCES.md has both).
export const SPARK_BASE = {
  blue: [70, 80, 90],
  pink: [1, 3, 5],
  white: [3, 6, 9],
  unique: [5, 10, 15],
  race: [1, 2, 3],
  scenario: [3, 6, 9],
} as const;

export type SparkType = keyof typeof SPARK_BASE;

// "Green" is what players call a unique-skill spark; `unique` is the
// reference's word, kept in the document because it is the game's own.
export const SPARK_TYPE_LABELS: Record<SparkType, string> = {
  blue: "Blue",
  pink: "Pink",
  white: "White",
  unique: "Green",
  race: "Race",
  scenario: "Scenario",
};

// Three inheritance events happen over a career, but only the 2nd and 3rd
// vary with compatibility — so a spark gets two chances that this model can
// speak to, and the run chance is 1 − (1−p)².
const EVENTS = 2;

// One event's chance, as a fraction. Affinity scales the base linearly and
// the product is capped at certainty: a 9-base white at 1000 affinity would
// otherwise compute past 100%.
export function eventChance(type: SparkType, stars: number, affinity: number): number {
  const base = SPARK_BASE[type][stars - 1];
  if (base === undefined) return 0;
  return Math.min(base * (1 + affinity / 100), 100) / 100;
}

// The chance ONE member passes this spark on over the run, as a PERCENT
// (0–100).
//
// Null when it can't be estimated rather than 0: a member who isn't cast has
// no affinity to roll against, and "no answer" is a different row from a real
// zero — the same distinction the affinity panels keep.
export function runChance(
  type: SparkType,
  stars: number,
  affinity: number | null
): number | null {
  if (affinity === null) return null;
  const p = eventChance(type, stars, affinity);
  return (1 - (1 - p) ** EVENTS) * 100;
}

// Which spark, as the document identifies it — the pink's aptitude, or any
// other kind's factor key. Two members carry the SAME spark when these match;
// the display name is resolved from the reference at render time.
export type SparkRef =
  | { type: "pink"; aptitude: AptitudeKey }
  | { type: SlotFactorKind; key: number };

export const sparkId = (ref: SparkRef): string =>
  ref.type === "pink" ? `pink:${ref.aptitude}` : `${ref.type}:${ref.key}`;

// One member's spark, with the chance she is the reason the trainee has it.
export type SparkChance = SparkRef & {
  stars: number;
  chance: number | null;
};

// Every spark a member carries, best chance first. Ties break on the spark id
// so the order is stable across re-scores rather than shuffling on every
// keystroke.
export function memberSparks(
  pink: PinkSpark | null,
  factors: readonly SlotFactor[],
  affinity: number | null
): SparkChance[] {
  const out: SparkChance[] = [];
  if (pink !== null) {
    out.push({
      type: "pink",
      aptitude: pink.aptitude,
      stars: pink.stars,
      chance: runChance("pink", pink.stars, affinity),
    });
  }
  for (const f of factors) {
    out.push({
      type: f.kind,
      key: f.key,
      stars: f.stars,
      chance: runChance(f.kind, f.stars, affinity),
    });
  }
  return out.sort(
    (a, b) => (b.chance ?? -1) - (a.chance ?? -1) || sparkId(a).localeCompare(sparkId(b))
  );
}

// One spark on the trainee's roll-up: every member carrying it, and the
// chance she ends up with it from ANY of them.
export type SparkOutlook = SparkRef & {
  // Deliberately NO star level: carriers can hold the same spark at different
  // levels and `chance` is the union across them, so a row reading "★★★ 40.6%"
  // would invite "40.6% chance of a 3★" when 40.6% is the chance at ANY level.
  // The per-ancestor tabs carry the levels, one click away.
  //
  // Tree indices of the members carrying it, in tree order.
  from: number[];
  chance: number | null;
};

// Combine per-member chances into "will the trainee come out with this".
// Independent events, so the union is 1 − ∏(1−p): two members each at 16.7%
// give 30.6%, not 33.4%. Carriers whose chance is unknown (nobody cast) are
// left out of the product rather than treated as zero — the row still lists
// them, and its chance stays null if that leaves no estimable carrier.
export function combineOutlooks(
  perMember: readonly { index: number; sparks: readonly SparkChance[] }[]
): SparkOutlook[] {
  const byId = new Map<string, SparkOutlook>();
  for (const { index, sparks } of perMember) {
    for (const s of sparks) {
      const id = sparkId(s);
      const seen = byId.get(id);
      if (seen === undefined) {
        // Built explicitly rather than spread from `s`, so the star level it
        // carries is dropped rather than riding along unused.
        byId.set(
          id,
          s.type === "pink"
            ? { type: "pink", aptitude: s.aptitude, from: [index], chance: s.chance }
            : { type: s.type, key: s.key, from: [index], chance: s.chance }
        );
        continue;
      }
      seen.from.push(index);
      if (s.chance !== null) {
        seen.chance =
          seen.chance === null
            ? s.chance
            : (1 - (1 - seen.chance / 100) * (1 - s.chance / 100)) * 100;
      }
    }
  }
  return [...byId.values()].sort(
    (a, b) => (b.chance ?? -1) - (a.chance ?? -1) || sparkId(a).localeCompare(sparkId(b))
  );
}

const LISTABLE = new Set<string>(LIST_SPARK_KINDS);

/**
 * A proc table narrowed to a hunt: one row per wanted spark — the caller's
 * own row where the spark is carried, and a bare `chance: null` row (the
 * "—" idiom) where it isn't, which while planning is the row that matters
 * most (DECISIONS.md #43). Generic over the row shape because the trainee's
 * outlooks and a member's own sparks both take the same narrowing. Callers
 * sort with `sortSparks` as usual; a null chance already ranks last.
 *
 * Blue, pink and green rows pass through UNFILTERED: a list cannot name
 * those kinds, so under any selection they could never survive — and hiding
 * a 3★ blue's 90% because the user is hunting whites would misread the
 * filter's vocabulary as a verdict on the spark.
 */
export function listRows<T extends SparkRef & { chance: number | null }>(
  rows: readonly T[],
  wanted: readonly { kind: ListSparkKind; key: number }[]
): (T | { type: ListSparkKind; key: number; chance: null })[] {
  const byId = new Map(rows.map((r) => [sparkId(r), r]));
  return [
    ...wanted.map(
      (w) => byId.get(`${w.kind}:${w.key}`) ?? { type: w.kind, key: w.key, chance: null }
    ),
    ...rows.filter((r) => !LISTABLE.has(r.type)),
  ];
}

// ---------- display order ----------
// Also what decides what the trainee's fold hides: the fold is a HEIGHT clip
// over this order, not a selection taken on chance, so under the kind grouping
// the rows below it can include a high-chance white.
export type SparkSort = "chance" | "kind";

// Blue → Pink → Green → Race → White → Scenario, the game's own grouping. Not
// alphabetical and not the reference's (kind, name), which buries whites
// behind races.
//
// The chooser's browse sections use this too, so the order you pick sparks in
// and the order the tables group them in are one order, held once.
export const SPARK_TYPE_ORDER: Record<SparkType, number> = {
  blue: 0,
  pink: 1,
  unique: 2,
  race: 3,
  white: 4,
  scenario: 5,
};

// Ties break on the spark id in both modes, so the order is stable across
// re-scores rather than shuffling when an unrelated node is edited.
export function sortSparks<T extends SparkRef & { chance: number | null }>(
  rows: readonly T[],
  sort: SparkSort
): T[] {
  const byChance = (a: T, b: T) => (b.chance ?? -1) - (a.chance ?? -1);
  const byId = (a: T, b: T) => sparkId(a).localeCompare(sparkId(b));
  return [...rows].sort(
    sort === "kind"
      ? (a, b) =>
          SPARK_TYPE_ORDER[a.type] - SPARK_TYPE_ORDER[b.type] ||
          byChance(a, b) ||
          byId(a, b)
      : (a, b) => byChance(a, b) || byId(a, b)
  );
}

// One decimal throughout: the inputs are ★ (three values) and an integer
// affinity, so more precision would dress a coarse model as a fine one, and
// less would collapse the 1★ pink range — a 1★ at 0 affinity is 2.0% and at
// 300 is 7.8%, which rounds to one number at zero decimals.
export const formatChance = (pct: number): string => `${pct.toFixed(1)}%`;
