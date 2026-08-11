import {
  APTITUDE_KEYS,
  type AptitudeKey,
  type Factor,
  type PinkSpark,
  type Veteran,
} from "./api";
import { writeStore } from "./storage";

// Aptitude ints 1..8 map to letters G..S (verified: pink sparks gate on >= 7 = A).
const APT = "-GFEDCBAS";
export const apt = (n: number) => APT[n] ?? "?";

// Worst to best. Here rather than in aptitude.ts because blueprint.ts
// validates against it too, and aptitude.ts already imports blueprint.ts.
export const LETTER_ORDER: readonly string[] = [...APT.slice(1)];

// What a chara is called when the committed reference data has no entry for
// her — a card newer than the last regen. Built here rather than inline so
// the tree map can recognise it: an initial taken off this string is "C" for
// every unknown character, which is worse than no initial at all.
export const charaPlaceholder = (charaId: number) => `Chara ${charaId}`;
export const isCharaPlaceholder = (name: string | null): boolean =>
  name !== null && /^Chara \d+$/.test(name);
export const isLetter = (s: unknown): s is string =>
  typeof s === "string" && (LETTER_ORDER as readonly string[]).includes(s);

// Aptitudes grouped the way the game's detail screen shows them.
export const APT_GROUPS: [group: string, apts: [label: string, key: keyof Veteran][]][] = [
  [
    "Track",
    [
      ["Turf", "proper_ground_turf"],
      ["Dirt", "proper_ground_dirt"],
    ],
  ],
  [
    "Distance",
    [
      ["Sprint", "proper_distance_short"],
      ["Mile", "proper_distance_mile"],
      ["Medium", "proper_distance_middle"],
      ["Long", "proper_distance_long"],
    ],
  ],
  [
    "Style",
    [
      ["Front", "proper_running_style_nige"],
      ["Pace", "proper_running_style_senko"],
      ["Late", "proper_running_style_sashi"],
      ["End", "proper_running_style_oikomi"],
    ],
  ],
];

// Stat value → grade letter, verified against in-game veteran screens
// (1200→SS+, 1110→SS, 612→B, 488→C): 50-wide up to D+, 100-wide C..A+,
// 50-wide S..SS+, with SS+ ending at exactly 1200. Above that the uncap
// ladder runs in 100-wide bands from UG at 1201 — anchors confirmed
// in-game at 1201→UG, 1317→UF, 1613→UC.
const STAT_GRADES: [min: number, label: string][] = [
  [1901, "US"],
  [1801, "UA"],
  [1701, "UB"],
  [1601, "UC"],
  [1501, "UD"],
  [1401, "UE"],
  [1301, "UF"],
  [1201, "UG"],
  [1150, "SS+"],
  [1100, "SS"],
  [1050, "S+"],
  [1000, "S"],
  [900, "A+"],
  [800, "A"],
  [700, "B+"],
  [600, "B"],
  [500, "C+"],
  [400, "C"],
  [350, "D+"],
  [300, "D"],
  [250, "E+"],
  [200, "E"],
  [150, "F+"],
  [100, "F"],
  [50, "G+"],
  [0, "G"],
];
export const statGrade = (n: number): string =>
  STAT_GRADES.find(([min]) => n >= min)?.[1] ?? "G";

// Letter → color-family class, shared by stat grades and aptitude letters
// (SS/S gold, A orange, … G gray — same palette as the rank badges).
// The empty string is a substring of every string, so the guard asks for a
// first character before asking whether it's in the palette.
export const gradeClass = (letter: string): string => {
  const first = letter[0]?.toLowerCase() ?? "";
  return first !== "" && "sabcdefgu".includes(first) ? `ltr-${first}` : "";
};

// Affinity band symbol → color class, from the game's rank table
// (relations.json): △ ≤50, ○ 51–150, ◎ ≥151. Here rather than in either
// component because the map chip and the focus panel must colour the same
// symbol the same way.
const AFFINITY_CLASS: Record<string, string> = {
  "△": "aff-low",
  "○": "aff-good",
  "◎": "aff-best",
};
export const affinityClass = (symbol: string): string => AFFINITY_CLASS[symbol] ?? "";

export type SortKey = "rank_score" | "blue_spark" | "pink_spark" | "register_time" | "name";

export const SORTS: [label: string, key: SortKey][] = [
  ["Rating", "rank_score"],
  ["Sparks", "blue_spark"],
  ["Pink", "pink_spark"],
  ["Date Acquired", "register_time"],
  ["Name", "name"],
];

// Direction a key starts in when picked; the ▲/▼ toggle flips it from there.
export const DEFAULT_ASC: Record<SortKey, boolean> = {
  rank_score: false, // best first
  blue_spark: true, // 1★ Speed → 3★ Wit
  pink_spark: true, // 1★ Turf → 3★ End
  register_time: false, // newest first
  name: true,
};

// "Sparks" orders by the veteran's own blue spark only: stat in game order,
// star within the stat — ascending runs 1★ Speed, 2★ Speed, … 3★ Wit.
export const BLUE_ORDER = ["Speed", "Stamina", "Power", "Guts", "Wit"];
export const blueSparkRank = (v: Veteran): number => {
  const blue = v.factors.find((f) => f.kind === "blue");
  if (!blue) return -1;
  const stat = BLUE_ORDER.indexOf(blue.name);
  // A degraded label (stale reference data) sorts before 1★ Speed.
  return stat === -1 ? -1 : stat * 3 + (blue.star - 1);
};

// A pink factor packs its aptitude in the key (factor_id // 100) and its star
// count in the remainder. Keyed by numeric id rather than display name: the
// ids are game data, the names are strings we render. From
// app/data/factors.json, type 1.
const PINK_KEY_APTITUDE: Readonly<Record<number, AptitudeKey>> = {
  11: "turf", 12: "dirt",
  31: "sprint", 32: "mile", 33: "medium", 34: "long",
  21: "front", 22: "pace", 23: "late", 24: "end",
};

// The one pink a dump member carries. Every lineage member has exactly one
// (verified against a full dump); taking the strongest rather than the first
// degrades a future multi-pink record to the useful answer.
export function pinkOf(factors: readonly Factor[]): PinkSpark | null {
  let best: PinkSpark | null = null;
  for (const f of factors) {
    const aptitude = PINK_KEY_APTITUDE[f.key];
    // Both checks: no non-pink factor uses a key in this range today, and the
    // kind is what keeps that true if one ever does.
    if (f.kind !== "pink" || aptitude === undefined || f.star < 1 || f.star > 3) continue;
    if (best === null || f.star > best.stars) best = { aptitude, stars: f.star };
  }
  return best;
}

// "Pink" is the blue rank's analogue over the veteran's own pink: aptitude in
// the game's group order (Track → Distance → Style — APTITUDE_KEYS is already
// exactly that), star within the aptitude. No pink sorts before 1★ Turf.
export const pinkSparkRank = (v: Veteran): number => {
  const pink = pinkOf(v.factors);
  return pink === null ? -1 : APTITUDE_KEYS.indexOf(pink.aptitude) * 3 + (pink.stars - 1);
};

// Rating → rank-tier breakpoints (community-documented; the dump's own
// `rank` field is a raw id, not the displayed tier). First row whose
// minimum the score clears wins — note the U tiers sit above SS+.
export const RANK_TIERS: [min: number, label: string][] = [
  [63400, "US"],
  [55200, "UA"],
  [47600, "UB"],
  [40700, "UC"],
  [34400, "UD"],
  [28800, "UE"],
  [23900, "UF"],
  [19600, "UG"],
  [19200, "SS+"],
  [17500, "SS"],
  [15900, "S+"],
  [14500, "S"],
  [12100, "A+"],
  [10000, "A"],
  [8200, "B+"],
  [6500, "B"],
  [4900, "C+"],
  [3500, "C"],
  [2900, "D+"],
  [2300, "D"],
  [1800, "E+"],
  [1300, "E"],
  [900, "F+"],
  [600, "F"],
  [300, "G+"],
  [0, "G"],
];
export const rankTier = (score: number): string =>
  RANK_TIERS.find(([min]) => score >= min)?.[1] ?? "G";

// Card-strip labels for the own-spark display, matching the game's veteran
// list (WIT · MED · UNIQ …). Unmapped names (stale reference data) degrade
// to a five-letter uppercase clip instead of hiding the spark.
export const SPARK_ABBR: Record<string, string> = {
  Speed: "SPD",
  Stamina: "STA",
  Power: "POW",
  Guts: "GUTS",
  Wit: "WIT",
  Turf: "TURF",
  Dirt: "DIRT",
  Sprint: "SPRINT",
  Mile: "MILE",
  Medium: "MED",
  Long: "LONG",
  "Front Runner": "FRONT",
  "Pace Chaser": "PACE",
  "Late Surger": "LATE",
  "End Closer": "END",
};
export const sparkAbbr = (name: string) =>
  SPARK_ABBR[name] ?? name.slice(0, 5).toUpperCase();

// The roster derivations the roster page and the designer's picker both need,
// shared so the picker can't silently order or group veterans differently from
// the page it mirrors. The filter's spark vocabulary lives in filters.ts as
// `commonSparkNamesOf`, beside the pool rule that decides what belongs in it.

// One entry per distinct card, for the Umas filter section.
export const rosterCardsOf = (veterans: Veteran[]): Veteran[] => {
  const seen = new Map<number, Veteran>();
  for (const v of veterans) if (!seen.has(v.card_id)) seen.set(v.card_id, v);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.card_id - b.card_id);
};

// Sorted copy, never in place.
export const sortVeterans = (veterans: Veteran[], sort: SortPref): Veteran[] => {
  const val = (v: Veteran) =>
    sort.key === "blue_spark"
      ? blueSparkRank(v)
      : sort.key === "pink_spark"
        ? pinkSparkRank(v)
        : v[sort.key];
  return [...veterans].sort((a, b) => {
    const av = val(a);
    const bv = val(b);
    // register_time is ISO, so string compare doubles as date order.
    const cmp =
      typeof av === "string" && typeof bv === "string"
        ? av.localeCompare(bv)
        : Number(av) - Number(bv);
    return sort.asc ? cmp : -cmp;
  });
};

export type SortPref = { key: SortKey; asc: boolean };
export const SORT_STORE = "umalab.sort";
// The designer's slot picker sorts under its own key, as it filters under its
// own (DECISIONS.md #31) — the two stay independent in both directions.
export const PICKER_SORT_STORE = "umalab.picker.sort";
const defaultSort: SortPref = { key: "register_time", asc: false };

export function loadSortPref(store: string = SORT_STORE): SortPref {
  try {
    const raw = localStorage.getItem(store);
    if (raw) {
      const p = JSON.parse(raw) as Partial<SortPref>;
      if (SORTS.some(([, k]) => k === p.key) && typeof p.asc === "boolean") {
        return p as SortPref;
      }
    }
  } catch {
    // unreadable storage or garbage value — fall through to the default
  }
  return defaultSort;
}

export function saveSortPref(sort: SortPref, store: string = SORT_STORE): void {
  writeStore(store, sort);
}

// What the line under a card's art shows. Manual and independent of the sort
// (DECISIONS.md #45 — before that it followed the Sparks sort). A future mode
// (matching sparks, matching races) is one tuple stop, one label, and one
// render branch in VeteranCard.
export const CAPTION_MODES = ["score", "sparks"] as const;
export type CaptionMode = (typeof CAPTION_MODES)[number];
export const CAPTION_LABELS: Record<CaptionMode, string> = {
  score: "Score",
  sparks: "Sparks",
};
export const CAPTION_STORE = "umalab.caption";
// The picker's caption lives under its own key, as its sort and filters do
// (DECISIONS.md #31) — the two surfaces stay independent in both directions.
export const PICKER_CAPTION_STORE = "umalab.picker.caption";

export function loadCaptionMode(store: string = CAPTION_STORE): CaptionMode {
  try {
    const raw = localStorage.getItem(store);
    if (raw) {
      const p: unknown = JSON.parse(raw);
      if ((CAPTION_MODES as readonly unknown[]).includes(p)) return p as CaptionMode;
    }
  } catch {
    // unreadable storage or garbage value — fall through to the default
  }
  return "score";
}

export function saveCaptionMode(mode: CaptionMode, store: string = CAPTION_STORE): void {
  writeStore(store, mode);
}

export const nextCaptionMode = (mode: CaptionMode): CaptionMode =>
  CAPTION_MODES[(CAPTION_MODES.indexOf(mode) + 1) % CAPTION_MODES.length];

// The fixed set of assignable tag ids — must match backend/app/data/tag_icons.json.
// Art comes from an out-of-repo extraction tool (DECISIONS.md #10) and is
// gitignored; without it the <MarkIcon> fallback renders the mark number instead.
export const MARK_IDS = Array.from(
  { length: 15 },
  (_, i) => `mark_${String(i + 1).padStart(2, "0")}`
);

// Hover/aria names for the marks. The game ships no text for them, so these
// describe the art: food, card suits, shoe colors, handshake — in the same
// grouped order the game lists them.
export const MARK_LABELS: Record<string, string> = {
  mark_01: "Carrot",
  mark_02: "Rice bowl",
  mark_03: "Juice",
  mark_04: "Chocolate cake",
  mark_05: "Cake",
  mark_06: "Diamond",
  mark_07: "Spade",
  mark_08: "Heart",
  mark_09: "Club",
  mark_10: "Pink shoe",
  mark_11: "Green shoe",
  mark_12: "Orange shoe",
  mark_13: "Blue shoe",
  mark_14: "Red shoe",
  mark_15: "Handshake",
};
// Degrades to the numbered form for an id outside the known set (stale
// reference data), same spirit as sparkAbbr.
export const markLabel = (id: string): string =>
  MARK_LABELS[id] ?? `Mark ${Number(id.slice(-2))}`;
