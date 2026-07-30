import type {
  AffinityRequest,
  Blueprint,
  BlueprintIn,
  BlueprintSlot,
  Factor,
  Veteran,
} from "./api";
import { BLUE_ORDER } from "./domain";
import { PINK_SPARK_GROUPS, isCommonKind } from "./filters";

// ---------- the designed lineage ----------
// Pure designer domain (the analog of filters.ts): slot shapes, the working
// Design, and every rule the page needs without touching React or fetch.

export type SlotId = "p1" | "p2" | "g11" | "g12" | "g21" | "g22";
export type ParentId = "p1" | "p2";

export const SLOT_IDS: readonly SlotId[] = ["p1", "p2", "g11", "g12", "g21", "g22"];
export const GP_OF: Record<ParentId, readonly [SlotId, SlotId]> = {
  p1: ["g11", "g12"],
  p2: ["g21", "g22"],
};

export const SLOT_LABELS: Record<SlotId, string> = {
  p1: "Parent 1",
  p2: "Parent 2",
  g11: "Grandparent 1-1",
  g12: "Grandparent 1-2",
  g21: "Grandparent 2-1",
  g22: "Grandparent 2-2",
};

// The AffinityResult link each slot terminates (win points are folded into
// the triple links server-side, so one chip per slot covers every edge
// except p1-p2, which the affinity table lists).
export const SLOT_LINK: Record<SlotId, string> = {
  p1: "t-p1",
  p2: "t-p2",
  g11: "t-p1-g11",
  g12: "t-p1-g12",
  g21: "t-p2-g21",
  g22: "t-p2-g22",
};

export const LINK_LABELS: Record<string, string> = {
  "t-p1": "Trainee · Parent 1",
  "t-p2": "Trainee · Parent 2",
  "p1-p2": "Parent 1 · Parent 2",
  "t-p1-g11": "Parent 1 · GP 1-1",
  "t-p1-g12": "Parent 1 · GP 1-2",
  "t-p2-g21": "Parent 2 · GP 2-1",
  "t-p2-g22": "Parent 2 · GP 2-2",
};

// Mirrors the API slot: a theoretical catalog pick, a roster veteran, or a
// lineage member auto-filled from a roster parent's own parents. Every
// variant snapshots win_saddle_ids so scoring never depends on the veteran
// still being in the roster.
export type SlotValue =
  | { source: "catalog"; chara_id: number; card_id: number; win_saddle_ids: number[] }
  | {
      source: "roster";
      chara_id: number;
      card_id: number;
      win_saddle_ids: number[];
      trained_chara_id: number;
    }
  | {
      source: "lineage";
      chara_id: number;
      card_id: number;
      win_saddle_ids: number[];
      trained_chara_id: number;
      position_id: number;
    };

export interface Design {
  id: number | null; // null until first saved
  name: string;
  trainee: number | null; // chara_id; trainees are catalog-only picks
  slots: Record<SlotId, SlotValue | null>;
}

export const emptyDesign = (): Design => ({
  id: null,
  name: "",
  trainee: null,
  slots: { p1: null, p2: null, g11: null, g12: null, g21: null, g22: null },
});

// ---------- building slot values ----------

export const catalogSlot = (charaId: number, cardId: number): SlotValue => ({
  source: "catalog",
  chara_id: charaId,
  card_id: cardId,
  win_saddle_ids: [],
});

export const rosterSlot = (v: Veteran): SlotValue => ({
  source: "roster",
  chara_id: v.chara_id,
  card_id: v.card_id,
  win_saddle_ids: v.win_saddles,
  trained_chara_id: v.trained_chara_id,
});

// A roster parent's own parents live at lineage positions 10 and 20 — those
// two members (never 11/12/21/22) become the designed grandparents.
export function lineageGpSlots(v: Veteran): [SlotValue | null, SlotValue | null] {
  const at = (pos: number): SlotValue | null => {
    const m = v.lineage.find((mm) => mm.position_id === pos);
    return m === undefined
      ? null
      : {
          source: "lineage",
          chara_id: m.chara_id,
          card_id: m.card_id,
          win_saddle_ids: m.win_saddles,
          trained_chara_id: v.trained_chara_id,
          position_id: m.position_id,
        };
  };
  return [at(10), at(20)];
}

// Parent picks carry their grandparents with them:
// - a roster pick auto-fills both GP slots from its stored lineage
//   (overriding whatever was there — the pick means "this pair");
// - clearing a parent clears its GPs (they described that parent's side);
// - a catalog pick drops auto-filled lineage GPs (they belonged to the
//   previous roster parent) but keeps manual picks — a parent pick that
//   would conflict with one is unpickable via slotConflicts, so nothing
//   here ever silently empties a slot the user filled.
export function setParentSlot(
  design: Design,
  parentId: ParentId,
  value: SlotValue | null,
  veteran?: Veteran | null
): Design {
  const slots = { ...design.slots, [parentId]: value };
  const [ga, gb] = GP_OF[parentId];
  if (value === null) {
    slots[ga] = null;
    slots[gb] = null;
  } else if (veteran) {
    [slots[ga], slots[gb]] = lineageGpSlots(veteran);
  } else {
    for (const g of [ga, gb]) {
      if (slots[g]?.source === "lineage") slots[g] = null;
    }
  }
  return { ...design, slots };
}

// ---------- game-rule mirror ----------
// Grey-out reasons for the picker. The server stays the authority (its 422
// still surfaces in the toast); this only spares obviously dead clicks.
// Deliberately absent: a GP repeating the TRAINEE's chara — the game allows
// it (it scores 0 on its relation triple but keeps its win overlap).
export function slotConflicts(
  design: Design,
  target: "trainee" | SlotId,
  charaId: number
): string | null {
  const s = design.slots;
  if (target === "trainee") {
    return s.p1?.chara_id === charaId || s.p2?.chara_id === charaId
      ? "Already a parent — the trainee must differ from both parents"
      : null;
  }
  if (target === "p1" || target === "p2") {
    if (design.trainee === charaId) return "A parent can't be the trainee's own character";
    const other = target === "p1" ? s.p2 : s.p1;
    if (other?.chara_id === charaId) return "The two parents must be different characters";
    const [ga, gb] = GP_OF[target];
    return s[ga]?.chara_id === charaId || s[gb]?.chara_id === charaId
      ? "Already one of this parent's grandparents — a grandparent can't repeat its parent"
      : null;
  }
  const parentId: ParentId = target === "g11" || target === "g12" ? "p1" : "p2";
  if (s[parentId]?.chara_id === charaId) {
    return "A grandparent can't repeat its own parent's character";
  }
  const [ga, gb] = GP_OF[parentId];
  const sibling = target === ga ? gb : ga;
  return s[sibling]?.chara_id === charaId
    ? "This parent's two grandparents must be different"
    : null;
}

// ---------- roster lookups ----------

// Roster/lineage slots reference their backing veteran by trained_chara_id
// (survives full-replace imports). null ⇒ the veteran left the roster — the
// slot still renders and scores from its snapshot, minus a badge.
export function resolveVeteran(slot: SlotValue, veterans: Veteran[]): Veteran | null {
  if (slot.source === "catalog") return null;
  return veterans.find((v) => v.trained_chara_id === slot.trained_chara_id) ?? null;
}

export const slotWinSaddles = (slot: SlotValue): number[] => slot.win_saddle_ids;

// Display name straight from the roster snapshot's backing veteran — the
// tile fallback when the catalog (a separate fetch) is unavailable.
export function slotDisplayName(slot: SlotValue, veterans: Veteran[]): string | null {
  if (slot.source === "catalog") return null;
  const v = resolveVeteran(slot, veterans);
  if (v === null) return null;
  if (slot.source === "roster") return v.name;
  return v.lineage.find((m) => m.position_id === slot.position_id)?.name ?? null;
}

// Sparks a slot contributes to the designed lineage: a roster pick brings
// its own factors, a lineage pick the stored member's; catalog picks and
// slots whose veteran left the roster contribute nothing.
export function slotFactors(slot: SlotValue, veterans: Veteran[]): Factor[] {
  if (slot.source === "catalog") return [];
  const v = resolveVeteran(slot, veterans);
  if (v === null) return [];
  if (slot.source === "roster") return v.factors;
  return v.lineage.find((m) => m.position_id === slot.position_id)?.factors ?? [];
}

// ---------- spark totals ----------

export interface SparkTotal {
  name: string;
  stars: number;
  kind: string;
}

export interface SparkTotalsData {
  blue: SparkTotal[];
  pink: SparkTotal[];
  unique: SparkTotal[];
  common: SparkTotal[];
}

const PINK_ORDER = PINK_SPARK_GROUPS.flatMap(([, chips]) => chips.map(([, name]) => name));

const gameOrder = (order: string[]) => (a: SparkTotal, b: SparkTotal) => {
  const ai = order.indexOf(a.name);
  const bi = order.indexOf(b.name);
  // Unknown names (stale reference data) sort last, alphabetically.
  if (ai === -1 && bi === -1) return a.name.localeCompare(b.name);
  if (ai === -1 || bi === -1) return ai === -1 ? 1 : -1;
  return ai - bi;
};

const byStarsDesc = (a: SparkTotal, b: SparkTotal) =>
  b.stars - a.stars || a.name.localeCompare(b.name);

export function aggregateSparks(design: Design, veterans: Veteran[]): SparkTotalsData {
  const buckets: Record<keyof SparkTotalsData, Map<string, SparkTotal>> = {
    blue: new Map(),
    pink: new Map(),
    unique: new Map(),
    common: new Map(),
  };
  for (const id of SLOT_IDS) {
    const slot = design.slots[id];
    if (slot === null) continue;
    for (const f of slotFactors(slot, veterans)) {
      const bucket =
        f.kind === "blue" || f.kind === "pink" || f.kind === "unique"
          ? f.kind
          : isCommonKind(f.kind)
            ? "common"
            : null;
      if (bucket === null) continue;
      const cur = buckets[bucket].get(f.name);
      if (cur === undefined) {
        buckets[bucket].set(f.name, { name: f.name, stars: f.star, kind: f.kind });
      } else {
        cur.stars += f.star;
      }
    }
  }
  return {
    blue: [...buckets.blue.values()].sort(gameOrder(BLUE_ORDER)),
    pink: [...buckets.pink.values()].sort(gameOrder(PINK_ORDER)),
    unique: [...buckets.unique.values()].sort(byStarsDesc),
    common: [...buckets.common.values()].sort(byStarsDesc),
  };
}

// ---------- API conversions ----------

const slotToApi = (s: SlotValue | null): BlueprintSlot | null =>
  s === null
    ? null
    : {
        source: s.source,
        chara_id: s.chara_id,
        card_id: s.card_id,
        win_saddle_ids: s.win_saddle_ids,
        trained_chara_id: s.source === "catalog" ? null : s.trained_chara_id,
        position_id: s.source === "lineage" ? s.position_id : null,
      };

export const toApi = (design: Design): BlueprintIn => ({
  name: design.name,
  trainee_chara_id: design.trainee,
  slots: {
    p1: slotToApi(design.slots.p1),
    p2: slotToApi(design.slots.p2),
    g11: slotToApi(design.slots.g11),
    g12: slotToApi(design.slots.g12),
    g21: slotToApi(design.slots.g21),
    g22: slotToApi(design.slots.g22),
  },
});

// Throws on a shape this client doesn't understand (e.g. a slot written by
// a future version) — the caller degrades to a toast, not a crash.
function slotFromApi(raw: BlueprintSlot | null | undefined): SlotValue | null {
  if (raw === null || raw === undefined) return null;
  const base =
    typeof raw.chara_id === "number" &&
    typeof raw.card_id === "number" &&
    Array.isArray(raw.win_saddle_ids) &&
    raw.win_saddle_ids.every((n) => typeof n === "number");
  if (!base) throw new Error("malformed blueprint slot");
  const common = {
    chara_id: raw.chara_id,
    card_id: raw.card_id,
    win_saddle_ids: raw.win_saddle_ids,
  };
  switch (raw.source) {
    case "catalog":
      return { source: "catalog", ...common };
    case "roster":
      if (typeof raw.trained_chara_id !== "number") {
        throw new Error("roster slot without trained_chara_id");
      }
      return { source: "roster", ...common, trained_chara_id: raw.trained_chara_id };
    case "lineage":
      if (typeof raw.trained_chara_id !== "number" || typeof raw.position_id !== "number") {
        throw new Error("lineage slot without trained_chara_id/position_id");
      }
      return {
        source: "lineage",
        ...common,
        trained_chara_id: raw.trained_chara_id,
        position_id: raw.position_id,
      };
    default:
      throw new Error(`unknown slot source ${String(raw.source)}`);
  }
}

export const fromApi = (bp: Blueprint): Design => {
  const slots: Partial<typeof bp.slots> | null = bp.slots;
  // Same strictness as the per-slot checks: a body missing `slots` must
  // throw, not parse as a legitimately blank design.
  if (slots === null || typeof slots !== "object") {
    throw new Error("blueprint without slots");
  }
  return {
    id: bp.id,
    name: bp.name,
    trainee: bp.trainee_chara_id,
    slots: {
      p1: slotFromApi(slots.p1),
      p2: slotFromApi(slots.p2),
      g11: slotFromApi(slots.g11),
      g12: slotFromApi(slots.g12),
      g21: slotFromApi(slots.g21),
      g22: slotFromApi(slots.g22),
    },
  };
};

export function toAffinityRequest(design: Design): AffinityRequest {
  const req: AffinityRequest = { trainee_chara_id: design.trainee };
  for (const id of SLOT_IDS) {
    const slot = design.slots[id];
    if (slot !== null) {
      req[id] = { chara_id: slot.chara_id, win_saddle_ids: slot.win_saddle_ids };
    }
  }
  return req;
}
