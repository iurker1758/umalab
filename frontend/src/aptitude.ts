import { APTITUDE_KEYS, type AptitudeKey, type AptitudeLetters } from "./api";
import { NAMED_COUNT, sparkAt, windowIndices, type Design } from "./blueprint";

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
export const LETTER_ORDER = ["G", "F", "E", "D", "C", "B", "A", "S"] as const;
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

export interface AptitudeRow {
  key: AptitudeKey;
  base: string | null; // null ⇒ the card's letters are unknown (regen gap)
  final: string | null; // base + bump, capped at A; null with unknown base
  boosted: boolean; // final ended up above base
  stars: number; // total matching ★ in the window
  bump: number; // bracket letters those ★ are worth
  capExcess: number; // bump letters wasted past the A cap — soft info only
}

// The ten display rows for a named node. Letters need the node's card;
// star totals and brackets compute regardless (the window is card-blind).
export function aptitudeRows(
  design: Design,
  i: number,
  letters: AptitudeLetters | null
): AptitudeRow[] {
  const stars = windowStars(design, i);
  return APTITUDE_KEYS.map((key) => {
    const st = stars.get(key) ?? 0;
    const bump = bracketBump(st);
    const base = letters?.[key] ?? null;
    let final: string | null = null;
    let boosted = false;
    let capExcess = 0;
    if (base !== null) {
      const baseIdx = (LETTER_ORDER as readonly string[]).indexOf(base);
      if (baseIdx === -1) {
        final = base; // unknown letter (stale reference) — pass through
      } else {
        // min(base + bump, A); a base already past A (S) is left alone.
        const capIdx = Math.max(CAP, baseIdx);
        const finalIdx = Math.min(baseIdx + bump, capIdx);
        final = LETTER_ORDER[finalIdx];
        boosted = finalIdx > baseIdx;
        capExcess = baseIdx + bump - capIdx;
        if (capExcess < 0) capExcess = 0;
      }
    }
    return { key, base, final, boosted, stars: st, bump, capExcess };
  });
}

// A typed pink on generations 1–2 whose matching aptitude resolves below A
// couldn't exist: the game only generates pink sparks at A. Not checkable
// when the card's letters are unknown, or on anonymous deep slots (no card
// by design). The trainee carries no spark.
export function undroppableSpark(rows: AptitudeRow[], design: Design, i: number): boolean {
  if (i === 0 || i >= NAMED_COUNT) return false;
  const spark = design.named[i]?.spark;
  if (spark === undefined || spark === null) return false;
  const row = rows.find((r) => r.key === spark.aptitude);
  const final = row?.final ?? null;
  if (final === null) return false;
  const idx = (LETTER_ORDER as readonly string[]).indexOf(final);
  return idx !== -1 && idx < CAP;
}

// The map's one badge state, so the issue surfaces without clicking through.
// Only filled named nodes can carry it — an empty slot has no typed spark.
// (Overstacking past 10★ is deliberately unflagged: the extra sparks are
// still inspiration-proc tickets toward S, so it isn't a mistake.)
export function hasUndroppableSpark(
  design: Design,
  i: number,
  letters: AptitudeLetters | null
): boolean {
  if (i >= NAMED_COUNT || design.named[i] === null) return false;
  return undroppableSpark(aptitudeRows(design, i, letters), design, i);
}
