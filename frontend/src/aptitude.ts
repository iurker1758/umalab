import { APTITUDE_KEYS, type AptitudeKey, type AptitudeLetters } from "./api";
import { LETTER_ORDER } from "./domain";
import {
  NAMED_COUNT,
  sparkAt,
  windowIndices,
  type Design,
  type SlotValue,
} from "./blueprint";

// ---------- career-start aptitude math ----------
// Deterministic inheritance only (the semantic core of the deep tree): a
// node's base letters come from its card, and the pink sparks of its
// 2-generation window — 2 parents + 4 grandparents, equal weight — bump
// each matching aptitude by bracket. Probabilistic mid-career inspirations
// (the road to S) are v2's territory.

export const APTITUDE_LABELS: Record<AptitudeKey, string> = {
  turf: "Turf",
  dirt: "Dirt",
  sprint: "Sprint",
  mile: "Mile",
  medium: "Medium",
  long: "Long",
  front: "Front",
  pace: "Pace",
  late: "Late",
  end: "End",
};

// Grouped the way the game's detail screen shows them.
export const APTITUDE_GROUPS: [group: string, keys: AptitudeKey[]][] = [
  ["Track", ["turf", "dirt"]],
  ["Distance", ["sprint", "mile", "medium", "long"]],
  ["Style", ["front", "pace", "late", "end"]],
];

// Career-start ladder. S exists in the data scale but is unreachable at
// career start — inheritance caps at A.
const CAP = LETTER_ORDER.indexOf("A");

// Verified thresholds (triangulated vs GameWith/Kamigame): total matching ★
// over the window → +1/+2/+3/+4 letters at 1★/4★/7★/10★; 11★+ adds nothing.
export const bracketBump = (stars: number): number =>
  stars >= 10 ? 4 : stars >= 7 ? 3 : stars >= 4 ? 2 : stars >= 1 ? 1 : 0;

// Total matching ★ per aptitude across a node's 2-generation window.
export function windowStars(design: Design, i: number): Map<AptitudeKey, number> {
  const totals = new Map<AptitudeKey, number>();
  for (const j of windowIndices(i)) {
    const spark = sparkAt(design, j);
    if (spark !== null) {
      totals.set(spark.aptitude, (totals.get(spark.aptitude) ?? 0) + spark.stars);
    }
  }
  return totals;
}

// How a node's letters are arrived at, which follows from where it came from.
//
//   project — the career-start forecast: the card's base plus the brackets
//             its window earns. The designer's whole point, and the only
//             mode where the numbers below the letter mean anything.
//   trained — read off a roster veteran's own record. Not a forecast at all:
//             what she finished with, inheritance and training already in it.
//   base    — the card's letters and nothing more. For a member pulled out of
//             a dump's lineage: we know WHO she is and nothing about what she
//             trained to, and her window is permanently missing two thirds of
//             its slots, so a projection would be a floor dressed as a
//             forecast.
export type LetterMode = "project" | "trained" | "base";

export interface AptitudeRow {
  key: AptitudeKey;
  base: string | null; // null ⇒ the card's letters are unknown (regen gap)
  final: string | null; // the letter to show; null with unknown base
  boosted: boolean; // final ended up above base
  stars: number; // total matching ★ in the window
  bump: number; // bracket letters those ★ are worth
  // Letters the bump actually bought, after the ceiling took its cut — below
  // `bump` whenever the base sat close enough to it to bite. Null wherever no
  // bracket gain can be stated: outside "project" (a trained or base row is
  // not a projection, so it has none — `boosted` is what says the letters
  // differ there), or with a base that is unknown or unplaceable, where the ★
  // have nothing to land on.
  gained: number | null;
  mode: LetterMode; // stars/bump are 0 outside "project"
}

// Keyed off `source`, not off whether the letters happen to be there: a pulled
// node describes a horse who already ran, so projecting inheritance onto her
// would double-count what her career consumed and cap at A a mare who finished
// at S. With her letters missing, the honest fallback is her card's base,
// never the forecast.
export function letterModeOf(slot: SlotValue | null): LetterMode {
  if (slot === null || slot.source === "catalog") return "project";
  return slot.aptitudes !== null ? "trained" : "base";
}

// The ten display rows for a named node. `letters` are the card's base;
// `trained` is a roster pick's own record and wins outright when present, or
// the bracket math would count the same inheritance twice.
export function aptitudeRows(
  design: Design,
  i: number,
  letters: AptitudeLetters | null,
  mode: LetterMode = "project",
  trained: AptitudeLetters | null = null
): AptitudeRow[] {
  if (mode === "trained" && trained !== null) {
    return APTITUDE_KEYS.map((key) => ({
      key,
      // Her card's base is still the honest "before": the gap between it and
      // what she trained to is real, and worth highlighting as a boost.
      base: letters?.[key] ?? null,
      final: trained[key],
      // An unrecognised base (stale reference data) indexes as -1, which would
      // read as a boost on every row: if we can't place the base, we can't
      // claim a gain. The project branch below guards the same way.
      boosted:
        letters?.[key] !== undefined &&
        LETTER_ORDER.indexOf(letters[key]) !== -1 &&
        LETTER_ORDER.indexOf(trained[key]) > LETTER_ORDER.indexOf(letters[key]),
      stars: 0,
      bump: 0,
      gained: null,
      mode: "trained" as const,
    }));
  }
  if (mode === "base") {
    // The card, stated, and nothing added. See LetterMode.
    return APTITUDE_KEYS.map((key) => ({
      key,
      base: letters?.[key] ?? null,
      final: letters?.[key] ?? null,
      boosted: false,
      stars: 0,
      bump: 0,
      gained: null,
      mode: "base" as const,
    }));
  }
  const stars = windowStars(design, i);
  return APTITUDE_KEYS.map((key) => {
    const st = stars.get(key) ?? 0;
    const bump = bracketBump(st);
    const base = letters?.[key] ?? null;
    let final: string | null = null;
    let boosted = false;
    let gained: number | null = null;
    if (base !== null) {
      const baseIdx = LETTER_ORDER.indexOf(base);
      if (baseIdx === -1) {
        final = base; // unknown letter (stale reference) — pass through
      } else {
        // min(base + bump, A); a base already past A (S) is left alone.
        const capIdx = Math.max(CAP, baseIdx);
        const finalIdx = Math.min(baseIdx + bump, capIdx);
        final = LETTER_ORDER[finalIdx];
        boosted = finalIdx > baseIdx;
        // Measured off the letters, not the bracket: a 4★ on a B is worth +2
        // and moves one step, so `bump` is what the window paid and this is
        // what it bought. `boosted` doesn't separate them — it's true for
        // that row too.
        gained = finalIdx - baseIdx;
      }
    }
    return { key, base, final, boosted, stars: st, bump, gained, mode: "project" as const };
  });
}

// A PLANNED pink on generations 1–2 whose matching aptitude resolves below A
// couldn't exist: the game only generates pink sparks at A. This is the map's
// one badge state — overstacking past 10★ is deliberately unflagged, since the
// extra sparks are still inspiration-proc tickets toward S.
//
// Catalog slots only, and that restriction is load-bearing. A roster or
// lineage node's pink came out of a real dump, so a verdict that it couldn't
// drop is wrong by construction — and it would fire constantly, since a pulled
// grandparent's bracket window is half empty by design and her projected
// letters are only a lower bound.
//
// Takes rows rather than letters: callers rendering a node already have them,
// and the window scan behind them is the expensive part.
export function undroppableSpark(rows: AptitudeRow[], design: Design, i: number): boolean {
  if (i === 0 || i >= NAMED_COUNT) return false;
  const slot = design.named[i];
  const spark = slot?.spark;
  if (spark === undefined || spark === null) return false;
  if (slot !== null && slot.source !== "catalog") return false;
  const row = rows.find((r) => r.key === spark.aptitude);
  const final = row?.final ?? null;
  if (final === null) return false;
  const idx = LETTER_ORDER.indexOf(final);
  return idx !== -1 && idx < CAP;
}

// The verdict's one wording, shared by every surface that shows it (the
// focus panel's alert, the popout's pinned echo, the map chip's title) so a
// reword can't leave one behind.
export const UNDROPPABLE_TITLE =
  "Pink sparks only generate on aptitudes the member reached A in.";
export function undroppableMessage(aptitude: AptitudeKey): string {
  return `${APTITUDE_LABELS[aptitude]} resolves below A — pinks only drop at A.`;
}
