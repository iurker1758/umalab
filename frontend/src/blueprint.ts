import {
  APTITUDE_KEYS,
  type AptitudeKey,
  type Blueprint,
  type BlueprintIn,
  type BlueprintSlot,
  type Factor,
  type LineageMember,
  type PinkSpark,
  type Veteran,
} from "./api";

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

// Where a node's identity came from, mirroring the wire format:
//   catalog — hand-picked from the character list (the default path)
//   roster  — a real trained veteran, pulled out of your own roster
//   lineage — auto-filled from a roster pick's own succession slots
// The distinction is not cosmetic: it decides what a later pull may
// silently replace (see `planPull`), and roster/lineage slots carry the
// backing veteran's won saddles for the affinity scoring to come.
export type SlotSource = "catalog" | "roster" | "lineage";

// A designed named node. `spark` is the member's pink: catalog picks have no
// dump to read it from and it's typed in, roster/lineage picks arrive with
// the real one. The trainee never carries one. chara/card are null on a
// spark-only node — you can type the pink you're hunting before deciding who
// carries it (the bracket math only reads the sparks below a node). A node
// with neither identity nor spark is null.
//
// win_saddle_ids rides in the snapshot rather than being re-read from the
// roster: a veteran that leaves the roster must keep its win bonus when the
// blueprint is re-scored, not just its portrait.
export interface SlotValue {
  source: SlotSource;
  chara_id: number | null;
  card_id: number | null;
  win_saddle_ids: number[];
  // Which veteran backs this slot. The dump's stable key — it survives the
  // full-replace imports, unlike a row id. Null on catalog picks.
  trained_chara_id: number | null;
  // Which of that veteran's six succession slots this came from (10/20
  // parents, 11/12/21/22 grandparents). Lineage slots only.
  position_id: number | null;
  spark: PinkSpark | null;
}

// A hand-picked node: everything a catalog pick knows, which is only who.
export const catalogSlot = (
  charaId: number | null,
  cardId: number | null,
  spark: PinkSpark | null
): SlotValue => ({
  source: "catalog",
  chara_id: charaId,
  card_id: cardId,
  win_saddle_ids: [],
  trained_chara_id: null,
  position_id: null,
  spark,
});

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
      return spark === null ? design : withNamed(design, i, catalogSlot(null, null, spark));
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

// ---------- roster pulls ----------
// Mirrors app/ingest.py's derive_chara_id: 7-digit ids (the rarity-0 NPC
// copies) prefix an extra digit, so 9100101 is still chara 1001. Needed
// because a pulled spark stores only a card_id — the chara is derived, not
// carried, exactly as it is server-side.
export const deriveCharaId = (cardId: number): number =>
  cardId > 999_999 ? Math.floor((cardId % 1_000_000) / 100) : Math.floor(cardId / 100);

// A pink factor packs its aptitude in the key (factor_id // 100) and its
// star count in the remainder. Keyed by the numeric id rather than the
// reference's display name: the ids are game data, the names are strings we
// render. From app/data/factors.json, type 1.
const PINK_KEY_APTITUDE: Readonly<Record<number, AptitudeKey>> = {
  11: "turf", 12: "dirt",
  31: "sprint", 32: "mile", 33: "medium", 34: "long",
  21: "front", 22: "pace", 23: "late", 24: "end",
};

// The one pink a dump member carries. Every lineage member has exactly one
// (verified against a full dump), but this takes the strongest rather than
// the first so a future multi-pink record degrades to the useful answer
// instead of an arbitrary one. `card_id` is the member's identity, which is
// what makes a pulled gen-3/4 spark distinguishable from a typed one.
export function pinkOf(factors: readonly Factor[], cardId?: number): PinkSpark | null {
  let best: PinkSpark | null = null;
  for (const f of factors) {
    const aptitude = PINK_KEY_APTITUDE[f.key];
    // Both checks: no non-pink factor uses a key in this range today, and
    // the kind is what keeps that true if one ever does.
    if (f.kind !== "pink" || aptitude === undefined || f.star < 1 || f.star > 3) continue;
    if (best === null || f.star > best.stars) {
      best = cardId === undefined
        ? { aptitude, stars: f.star }
        : { aptitude, stars: f.star, card_id: cardId };
    }
  }
  return best;
}

// Which succession slot feeds which tree node, relative to the node the
// veteran itself lands in. A veteran's dump carries six members: 10/20 are
// its parents, 11/12 and 21/22 their parents in turn. So pulling a veteran
// into a node fills that node's two kids and four grandkids — two whole
// generations — which is the "2-gen auto-fill" the plan means.
//
// The classic error is off by one generation: a blueprint grandparent is the
// parent veteran's PARENT (position 10/20), never its grandparent.
export function pullTargets(target: number): { index: number; position: number }[] {
  const [a, b] = kidsOf(target);
  const [c, d] = kidsOf(a);
  const [e, f] = kidsOf(b);
  return [
    { index: a, position: 10 },
    { index: b, position: 20 },
    { index: c, position: 11 },
    { index: d, position: 12 },
    { index: e, position: 21 },
    { index: f, position: 22 },
  ].filter((t) => t.index < NODE_COUNT);
}

// Every node at or below `i` — the branch a node roots. Breadth-first from
// the node itself, so a pull can replace a whole ancestry rather than
// patching seven nodes of it.
export function subtreeOf(i: number): number[] {
  const out: number[] = [];
  const queue = [i];
  while (queue.length > 0) {
    const j = queue.shift() as number;
    if (j >= NODE_COUNT) continue;
    out.push(j);
    queue.push(...kidsOf(j));
  }
  return out;
}

// The trainee is the horse you are about to train. It is not in your roster
// — that is the whole point of it — and nothing is bred from it, so a roster
// pick has nothing to mean at node 0. It would also be the one click that
// empties all 31 nodes. Catalog only, there.
export const canPullInto = (i: number): boolean => i > 0;

// One node a pull would write. Named indices carry a whole slot; the deeper
// ones carry a bare spark (with the member's card_id, so the identity that
// arrived in the fetch isn't thrown away).
export interface PullWrite {
  index: number;
  slot?: SlotValue;
  spark?: PinkSpark;
}

export interface PullPlan {
  writes: PullWrite[];
  // The rest of the branch: emptied, not left as it was. What sits under a
  // node is that node's ancestry, so replacing the node makes all of it
  // stale — and leaving it would feed the new grandparents' brackets from
  // the previous plan's sparks, which is a wrong number rather than an old
  // one. Generation 4 always ends up here: the game stores two generations
  // per veteran, so a pull has nothing to put there.
  clears: number[];
  // Nodes in the branch whose current content a human authored — a catalog
  // pick, a roster pick, or a typed spark. Everything else (empty, or filled
  // by an earlier pull) is replaced without asking: it was never
  // hand-authored, so there is nothing to lose. See DECISIONS.md #28.
  clobbers: number[];
}

// Was this node's content authored by hand? Deep spark slots have no source
// field, and don't need one: only a pull sets a spark's card_id, and the
// spark editor writes a fresh {aptitude, stars} — so carrying an identity IS
// the mark of a pulled spark.
//
// Since generation 4 stores no identity, a spark a pull put there reads as
// hand-authored and the next pull into that grandparent asks about it
// needlessly. That errs toward asking, which is the safe direction, and only
// arises when you re-pull the same grandparent.
function handAuthored(design: Design, i: number): boolean {
  if (i < NAMED_COUNT) {
    const slot = design.named[i];
    return slot !== null && slot.source !== "lineage";
  }
  const spark = design.sparks[i - NAMED_COUNT];
  return spark !== null && spark.card_id == null;
}

const lineageSlot = (
  member: LineageMember,
  trainedCharaId: number
): SlotValue => ({
  source: "lineage",
  chara_id: member.chara_id,
  card_id: member.card_id,
  win_saddle_ids: member.win_saddles,
  trained_chara_id: trainedCharaId,
  position_id: member.position_id,
  spark: pinkOf(member.factors),
});

// What pulling `veteran` into `target` would do: replace that node's whole
// branch — the node and everything descended from it — with as much of the
// veteran's real pedigree as the dump carries, and empty the rest.
//
// A pull is not a patch. The branch under a node IS that node's ancestry, so
// swapping the node in makes every node below it describe someone else.
// Filling only the six slots the dump reaches would leave the generation
// below still feeding brackets from the plan you just replaced.
//
// Pure — the page decides whether to ask about `clobbers`, then applies the
// result through the normal autosave path.
//
// The picked node is planned like any other: its own typed spark counts as
// hand-authored too, so a pull never silently discards a pink you were
// hunting. Say yes and the veteran's real pink replaces it, which is the
// point of pulling a veteran you actually own.
export function planPull(design: Design, target: number, veteran: Veteran): PullPlan {
  if (!canPullInto(target)) throw new Error("the trainee can't be pulled from the roster");
  const byPosition = new Map(veteran.lineage.map((m) => [m.position_id, m]));
  const writes: PullWrite[] = [
    {
      index: target,
      slot: {
        source: "roster",
        chara_id: veteran.chara_id,
        card_id: veteran.card_id,
        win_saddle_ids: veteran.win_saddles,
        trained_chara_id: veteran.trained_chara_id,
        position_id: null,
        spark: pinkOf(veteran.factors),
      },
    },
  ];
  for (const { index, position } of pullTargets(target)) {
    const member = byPosition.get(position);
    // A dump can be short a member (an unbred parent). That node is emptied
    // like the rest of the branch rather than keeping what was there — the
    // veteran genuinely has nobody in that slot, and showing the previous
    // plan's pick as its parent would be a false answer, not a partial one.
    if (member === undefined) continue;
    if (index < NAMED_COUNT) {
      writes.push({ index, slot: lineageSlot(member, veteran.trained_chara_id) });
      continue;
    }
    // Below the grandparents there is nowhere to put a name, only a spark.
    // Generation 3 keeps the member's identity; generation 4 doesn't, even
    // when a grandparent-level pull happens to know it. Nothing that deep
    // reaches the trainee — a node's brackets read only its own two
    // generations — so the name would be trivia carried forever. Its SPARK
    // still lands: that feeds the grandparent's own letters, which is how
    // you tell whether the pink you want could drop there.
    const spark = pinkOf(member.factors, genOf(index) === 3 ? member.card_id : undefined);
    if (spark !== null) writes.push({ index, spark });
  }
  const written = new Set(writes.map((w) => w.index));
  const branch = subtreeOf(target);
  return {
    writes,
    clears: branch.filter((i) => !written.has(i)),
    clobbers: branch.filter((i) => handAuthored(design, i)),
  };
}

export function applyPull(design: Design, plan: PullPlan): Design {
  let next = design;
  // Clear first, then fill: the two sets are disjoint, so the order only
  // matters for readability, and "empty the branch, then populate it" is
  // what the rule actually says.
  for (const i of plan.clears) {
    next = i < NAMED_COUNT ? withNamed(next, i, null) : withSpark(next, i, null);
  }
  for (const w of plan.writes) {
    next = w.slot !== undefined
      ? withNamed(next, w.index, w.slot)
      : withSpark(next, w.index, w.spark ?? null);
  }
  return next;
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
        trained_chara_id: s.trained_chara_id,
        position_id: s.position_id,
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
// a future version) — the caller degrades to a toast, not a crash. Turning
// malformed into silently-blank is the data-loss shape DECISIONS.md #26 is
// about, so every one of these stays strict.
function sparkFromApi(raw: PinkSpark | null | undefined): PinkSpark | null {
  if (raw === null || raw === undefined) return null;
  const ok =
    APTITUDE_KEYS.includes(raw.aptitude) &&
    typeof raw.stars === "number" &&
    Number.isInteger(raw.stars) &&
    raw.stars >= 1 &&
    raw.stars <= 3;
  if (!ok) throw new Error("malformed pink spark");
  // Optional gen-3/4 identity. Absent on every hand-typed spark and on every
  // row written before the roster pull existed, so undefined is normal —
  // only a present-but-wrong value is malformed.
  const card = raw.card_id;
  if (card !== null && card !== undefined && !Number.isInteger(card)) {
    throw new Error("malformed pink spark identity");
  }
  return card === null || card === undefined
    ? { aptitude: raw.aptitude, stars: raw.stars }
    : { aptitude: raw.aptitude, stars: raw.stars, card_id: card };
}

const SOURCES: readonly string[] = ["catalog", "roster", "lineage"];

// Mirrors the backend's BlueprintSlotIn validator (app/schemas.py), so a
// document this parses is one the server would also accept.
function slotFromApi(raw: BlueprintSlot | null | undefined): SlotValue | null {
  if (raw === null || raw === undefined) return null;
  if (!SOURCES.includes(raw.source)) {
    throw new Error(`unsupported slot source ${String(raw.source)}`);
  }
  const source = raw.source;
  const spark = sparkFromApi(raw.spark);
  const wins = raw.win_saddle_ids ?? [];
  if (!Array.isArray(wins) || wins.some((w) => !Number.isInteger(w))) {
    throw new Error("malformed won-saddle ids");
  }
  const trained = raw.trained_chara_id ?? null;
  const position = raw.position_id ?? null;
  if (source !== "catalog" && typeof trained !== "number") {
    throw new Error(`a ${source} slot needs a trained_chara_id`);
  }
  if (source === "lineage" && typeof position !== "number") {
    throw new Error("a lineage slot needs a position_id");
  }
  // Spark-only slot: no character chosen yet. Only a catalog slot can be
  // one — a roster/lineage pick always knows who it pulled.
  if (raw.chara_id === null && raw.card_id === null) {
    if (spark === null || source !== "catalog") throw new Error("malformed blueprint slot");
    return catalogSlot(null, null, spark);
  }
  if (typeof raw.chara_id !== "number" || typeof raw.card_id !== "number") {
    throw new Error("malformed blueprint slot");
  }
  return {
    source,
    chara_id: raw.chara_id,
    card_id: raw.card_id,
    win_saddle_ids: wins,
    trained_chara_id: trained,
    position_id: position,
    spark,
  };
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
