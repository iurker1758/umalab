// Builders for the unit suite (DECISIONS.md #30). Test-only, and never
// imported by app code — it lives in src/ so `tsc -b` typechecks it against
// the real shapes, which is the point: a fixture that has drifted from the
// API types should fail the build, not the assertion.
//
// Everything here is the boring end of the shape. Each test overrides the two
// or three fields it is actually about, so the interesting values stay at the
// call site rather than in a fixture file you have to go and read.

import type { Factor, LineageMember, Veteran } from "./api";
import { NAMED_COUNT, SPARK_COUNT, emptyDesign, type Design, type SlotValue } from "./blueprint";

// The kinds number their keys independently, so the id has to fold `kind` in
// or two genuinely different sparks come out sharing one — which would hide a
// collision from any future code that keys on the raw factor_id the way
// CLAUDE.md's invariant requires it be kept for.
const KIND_OFFSET: Record<Factor["kind"], number> = {
  blue: 1, pink: 2, white: 3, unique: 4, race: 5, scenario: 6, other: 7,
};

export const factor = (f: Partial<Factor> & Pick<Factor, "kind" | "key">): Factor => ({
  factor_id: (KIND_OFFSET[f.kind] * 1_000_000 + f.key) * 100 + (f.star ?? 1),
  star: 1,
  name: `factor-${f.key}`,
  ...f,
});

export const member = (
  m: Partial<LineageMember> & Pick<LineageMember, "position_id">
): LineageMember => ({
  relation: m.position_id % 10 === 0 ? "parent" : "grandparent",
  card_id: 100_100 + m.position_id,
  chara_id: 1001,
  name: `member-${m.position_id}`,
  outfit: "",
  rarity: 3,
  talent_level: 1,
  rank: 1,
  factors: [],
  win_saddles: [],
  ...m,
});

export const veteran = (v: Partial<Veteran> = {}): Veteran => ({
  id: 1,
  trained_chara_id: 900_000_001,
  card_id: 100_101,
  chara_id: 1001,
  name: "Vet",
  outfit: "",
  rarity: 3,
  talent_level: 1,
  rank: 1,
  rank_score: 10_000,
  fans: 0,
  wins: 0,
  speed: 1000,
  stamina: 800,
  power: 800,
  guts: 400,
  wiz: 600,
  // 1..8 → G..S, so 7 is A across the board unless a test says otherwise.
  proper_distance_short: 7,
  proper_distance_mile: 7,
  proper_distance_middle: 7,
  proper_distance_long: 7,
  proper_ground_turf: 7,
  proper_ground_dirt: 7,
  proper_running_style_nige: 7,
  proper_running_style_senko: 7,
  proper_running_style_sashi: 7,
  proper_running_style_oikomi: 7,
  register_time: "2026-01-01T00:00:00",
  win_saddles: [],
  factors: [],
  skills: [],
  lineage: [],
  tags: [],
  title: "",
  ...v,
});

export const slot = (s: Partial<SlotValue> = {}): SlotValue => ({
  source: "catalog",
  chara_id: 1001,
  card_id: 100_101,
  win_saddle_ids: [],
  trained_chara_id: null,
  position_id: null,
  spark: null,
  aptitudes: null,
  factors: [],
  ...s,
});

// A design from a sparse index → value map, so a test names only the nodes it
// cares about. Named indices (0–6) take a SlotValue, deeper ones a DeepSlot.
export const designWith = (
  nodes: Record<number, Design["named"][number] | Design["sparks"][number]>
): Design => {
  const d = emptyDesign();
  for (const [key, value] of Object.entries(nodes)) {
    const i = Number(key);
    if (i < NAMED_COUNT) d.named[i] = value as SlotValue;
    else d.sparks[i - NAMED_COUNT] = value as Design["sparks"][number];
  }
  return d;
};

export { NAMED_COUNT, SPARK_COUNT };

// The two loaders under test read localStorage, which `environment: "node"`
// does not provide. A Map behind the four methods they use is the whole of
// what they need — jsdom for this would be a DOM implementation to test two
// JSON.parse guards.
export function stubLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  const stub: Pick<Storage, "getItem" | "setItem" | "removeItem" | "clear"> = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
  };
  install(stub);
  return store;
}

// Storage that throws on every access — a private window, or a quota that is
// already full. Both loaders promise to fall back rather than propagate.
export function stubBrokenLocalStorage(): void {
  const boom = (): never => {
    throw new Error("storage is blocked");
  };
  install({ getItem: boom, setItem: boom, removeItem: boom, clear: boom });
}

// Both stubs install a global, and the throwing one would otherwise outlive
// the test that wanted it — a describe appended below the storage tests would
// fail with "storage is blocked" and nothing in its own body to point at.
// Pair either stub with `afterEach(restoreLocalStorage)`.
let original: unknown;
let installed = false;

const install = (stub: unknown): void => {
  if (!installed) {
    original = (globalThis as { localStorage?: unknown }).localStorage;
    installed = true;
  }
  (globalThis as { localStorage?: unknown }).localStorage = stub;
};

export function restoreLocalStorage(): void {
  if (!installed) return;
  (globalThis as { localStorage?: unknown }).localStorage = original;
  installed = false;
}
