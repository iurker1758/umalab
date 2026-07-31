import { APTITUDE_KEYS, type Blueprint, type BlueprintIn, type BlueprintSlot, type PinkSpark } from "./api";

// ---------- the designed lineage ----------
// Pure designer domain (the analog of filters.ts): the 31-node tree shape,
// the working Design, and every rule the page needs without touching React
// or fetch. Aptitude/bracket math lives in aptitude.ts.

// Tree shape (DECISIONS.md #25): 31 nodes breadth-first — node i's kids are
// 2i+1 / 2i+2. Indices 0–6 (trainee, parents, grandparents) carry identity;
// 7–30 (generations 3–4) are anonymous pink-spark slots that exist only to
// feed the bracket math of the generations above.
export const NAMED_COUNT = 7;
export const SPARK_COUNT = 24;
export const NODE_COUNT = NAMED_COUNT + SPARK_COUNT;

export const kidsOf = (i: number): [number, number] => [2 * i + 1, 2 * i + 2];
export const parentOf = (i: number): number => (i - 1) >> 1;
// Generation = floor(log2(i+1)); clz avoids float edges.
export const genOf = (i: number): number => 31 - Math.clz32(i + 1);

// Which half of the tree a node sits in — 1 or 2, the parent whose branch
// contains it (0 for the trainee, which belongs to both).
export function halfOf(i: number): number {
  let j = i;
  while (j > 2) j = parentOf(j);
  return j;
}

// A node's 2-generation window: its kids and grandkids — the six lineage
// members whose pink sparks feed its career-start brackets.
export function windowIndices(i: number): number[] {
  const [a, b] = kidsOf(i);
  return [a, b, ...kidsOf(a), ...kidsOf(b)].filter((j) => j < NODE_COUNT);
}

export const NAMED_LABELS: readonly string[] = [
  "Trainee",
  "Parent 1",
  "Parent 2",
  "Grandparent 1-1",
  "Grandparent 1-2",
  "Grandparent 2-1",
  "Grandparent 2-2",
];

// Spark slots are labeled by generation and position within it: "Sparks 3-1"
// is tree index 7, "Sparks 4-16" is 30.
export function nodeLabel(i: number): string {
  if (i < NAMED_COUNT) return NAMED_LABELS[i];
  const gen = genOf(i);
  return `Sparks ${gen}-${i - ((1 << gen) - 1) + 1}`;
}

// A designed named node. V1 is catalog-only — roster/lineage sources return
// with the roster features in v2 of the designer (DECISIONS.md #26), and
// fromApi treats them like any other shape this client doesn't understand.
// `spark` is the member's typed-in pink: catalog picks have no dump to read
// it from, and the bracket math needs it. The trainee never carries one.
// chara/card are null on a spark-only node — you can type the pink you're
// hunting before deciding who carries it (the bracket math only reads the
// sparks below a node). A node with neither identity nor spark is null.
export interface SlotValue {
  chara_id: number | null;
  card_id: number | null;
  spark: PinkSpark | null;
}

export interface Design {
  id: number | null; // null until first saved
  name: string;
  named: (SlotValue | null)[]; // length 7, breadth-first; [0] = trainee
  sparks: (PinkSpark | null)[]; // length 24, tree indices 7–30
}

export const emptyDesign = (): Design => ({
  id: null,
  name: "",
  named: Array<SlotValue | null>(NAMED_COUNT).fill(null),
  sparks: Array<PinkSpark | null>(SPARK_COUNT).fill(null),
});

// ---------- reading and writing nodes ----------

// The pink spark at any tree index — a named member's typed pink or an
// anonymous deep slot's value.
export function sparkAt(design: Design, i: number): PinkSpark | null {
  return i < NAMED_COUNT ? (design.named[i]?.spark ?? null) : design.sparks[i - NAMED_COUNT];
}

export function withNamed(design: Design, i: number, value: SlotValue | null): Design {
  const named = design.named.slice();
  named[i] = value;
  return { ...design, named };
}

// A spark on an empty named node creates an identity-less slot; clearing the
// spark off one prunes it back to null, so an untouched node never persists
// as a husk (and the unsaved-changes check stays honest).
export function withSpark(design: Design, i: number, spark: PinkSpark | null): Design {
  if (i < NAMED_COUNT) {
    const slot = design.named[i];
    if (slot === null) {
      return spark === null
        ? design
        : withNamed(design, i, { chara_id: null, card_id: null, spark });
    }
    if (spark === null && slot.card_id === null) return withNamed(design, i, null);
    return withNamed(design, i, { ...slot, spark });
  }
  const sparks = design.sparks.slice();
  sparks[i - NAMED_COUNT] = spark;
  return { ...design, sparks };
}

// ---------- game-rule mirror ----------
// Grey-out reasons for the picker, generalized over the tree arithmetic.
// The server stays the authority (its 422 still surfaces in the toast);
// this only spares obviously dead clicks. Deliberately absent: a grandparent
// repeating the TRAINEE's chara — the game allows it.
export function slotConflicts(design: Design, target: number, charaId: number): string | null {
  const at = (i: number) => design.named[i]?.chara_id;
  if (target > 0) {
    if (at(parentOf(target)) === charaId) {
      return target <= 2
        ? "A parent can't be the trainee's own character"
        : "A grandparent can't repeat its own parent's character";
    }
    const sibling = target % 2 === 1 ? target + 1 : target - 1;
    if (at(sibling) === charaId) {
      return target <= 2
        ? "The two parents must be different characters"
        : "This parent's two grandparents must be different";
    }
  }
  if (target <= 2) {
    const [a, b] = kidsOf(target);
    if (at(a) === charaId || at(b) === charaId) {
      return target === 0
        ? "Already a parent — the trainee must differ from both parents"
        : "Already one of this parent's grandparents — a grandparent can't repeat its parent";
    }
  }
  return null;
}

// ---------- API conversions ----------

const slotToApi = (s: SlotValue | null): BlueprintSlot | null =>
  s === null
    ? null
    : {
        source: "catalog",
        chara_id: s.chara_id,
        card_id: s.card_id,
        win_saddle_ids: [],
        trained_chara_id: null,
        position_id: null,
        spark: s.spark,
      };

export const toApi = (design: Design): BlueprintIn => ({
  name: design.name,
  slots: {
    named: design.named.map(slotToApi),
    sparks: design.sparks.slice(),
  },
});

// Throws on a shape this client doesn't understand (e.g. a slot written by
// a future version) — the caller degrades to a toast, not a crash.
function sparkFromApi(raw: PinkSpark | null | undefined): PinkSpark | null {
  if (raw === null || raw === undefined) return null;
  const ok =
    APTITUDE_KEYS.includes(raw.aptitude) &&
    typeof raw.stars === "number" &&
    Number.isInteger(raw.stars) &&
    raw.stars >= 1 &&
    raw.stars <= 3;
  if (!ok) throw new Error("malformed pink spark");
  return { aptitude: raw.aptitude, stars: raw.stars };
}

function slotFromApi(raw: BlueprintSlot | null | undefined): SlotValue | null {
  if (raw === null || raw === undefined) return null;
  // Roster/lineage sources are v2-of-the-designer shapes; nothing writes
  // them today (the v1 wipe emptied the table), so they parse as unknown.
  if (raw.source !== "catalog") throw new Error(`unsupported slot source ${String(raw.source)}`);
  const spark = sparkFromApi(raw.spark);
  // Spark-only slot: no character chosen yet.
  if (raw.chara_id === null && raw.card_id === null) {
    if (spark === null) throw new Error("malformed blueprint slot");
    return { chara_id: null, card_id: null, spark };
  }
  if (typeof raw.chara_id !== "number" || typeof raw.card_id !== "number") {
    throw new Error("malformed blueprint slot");
  }
  return { chara_id: raw.chara_id, card_id: raw.card_id, spark };
}

// ---------- which blueprint was open ----------
// Every design is a server row (DECISIONS.md #26): the page creates one on
// first load and autosaves from then on, so there is no local document to
// persist — only a pointer to the row you were last looking at, so a reload
// reopens it instead of whichever was edited most recently.
export const DESIGN_STORE = "umalab.designer.open";

export function readOpenId(): number | null {
  try {
    const raw = localStorage.getItem(DESIGN_STORE);
    const id = raw === null ? NaN : Number(JSON.parse(raw));
    return Number.isInteger(id) ? id : null;
  } catch {
    // blocked storage or a hand-edited value — fall back to "most recent"
    return null;
  }
}

export function writeOpenId(id: number | null): void {
  try {
    if (id === null) localStorage.removeItem(DESIGN_STORE);
    else localStorage.setItem(DESIGN_STORE, JSON.stringify(id));
  } catch {
    // storage full/blocked — the session still works, reloads just forget
  }
}

// New blueprints are born named. The first is plain "Untitled Blueprint" —
// a lone " - 1" is noise when there's nothing to be the first OF — and the
// numbering starts at 1 for the next one, taking the lowest free number, so
// deleting "- 2" of three reuses 2 rather than counting ever upward.
export const UNTITLED = "Untitled Blueprint";

// "X (copy)", then "X (copy 2)" — the same lowest-free-number rule as the
// untitled names, so duplicating twice doesn't collide.
export function copyName(name: string, existing: readonly { name: string }[]): string {
  const names = new Set(existing.map((b) => b.name.trim()));
  const base = `${name.trim()} (copy)`;
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${name.trim()} (copy ${n})`)) n++;
  return `${name.trim()} (copy ${n})`;
}

export function nextUntitledName(existing: readonly { name: string }[]): string {
  const names = new Set(existing.map((b) => b.name.trim()));
  if (!names.has(UNTITLED)) return UNTITLED;
  const taken = new Set<number>();
  for (const name of names) {
    const m = new RegExp(`^${UNTITLED} - (\\d+)$`).exec(name);
    if (m !== null) taken.add(Number(m[1]));
  }
  let n = 1;
  while (taken.has(n)) n++;
  return `${UNTITLED} - ${n}`;
}

export const fromApi = (bp: Blueprint): Design => {
  const slots: Partial<typeof bp.slots> | null = bp.slots;
  // Same strictness as the per-slot checks: a body missing either array (or
  // at the wrong length — the document is positional) must throw, not parse
  // as a legitimately blank or shifted design.
  if (
    slots === null ||
    typeof slots !== "object" ||
    !Array.isArray(slots.named) ||
    slots.named.length !== NAMED_COUNT ||
    !Array.isArray(slots.sparks) ||
    slots.sparks.length !== SPARK_COUNT
  ) {
    throw new Error("blueprint without a v2 slots document");
  }
  return {
    id: bp.id,
    name: bp.name,
    named: slots.named.map(slotFromApi),
    sparks: slots.sparks.map(sparkFromApi),
  };
};
