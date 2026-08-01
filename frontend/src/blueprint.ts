import {
  AFFINITY_SLOTS,
  APTITUDE_KEYS,
  type AffinityRequest,
  type AffinitySlotId,
  type AptitudeKey,
  type AptitudeLetters,
  type Blueprint,
  type BlueprintIn,
  type BlueprintSlot,
  type DeepSlot,
  type Factor,
  type LineageMember,
  type PinkSpark,
  type Veteran,
} from "./api";
import { apt, isLetter } from "./domain";

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

// ---------- run affinity ----------
// The named array is [trainee, p1, p2, g11, g12, g21, g22] — AFFINITY_SLOTS
// shifted by one for the trainee, which is a participant in every link and a
// slot in none. Anything below the grandparents is out of scope: the game
// scores affinity over three generations, whatever the tree holds.
export const affinitySlotOf = (i: number): AffinitySlotId | null =>
  i >= 1 && i <= AFFINITY_SLOTS.length ? AFFINITY_SLOTS[i - 1] : null;

// The link each node OWNS, for the map's decomposition: every term belongs to
// its deepest participant, so the six tiles plus the parent-pair link add up
// to the total exactly. `p1-p2` is owned by neither parent alone and appears
// on no tile — it is the gap between them (DECISIONS.md #15/#29).
//
// Not the same quantity as the API's `*_affinity`, which gives a parent her
// whole side (both triples included) because that is what an inspiration proc
// off her is rolled against. The two agree on grandparents and differ on
// parents; uma.moe carries both for the same reason.
export const OWNED_LINK: readonly (string | null)[] = [
  null, "t-p1", "t-p2", "t-p1-g11", "t-p1-g12", "t-p2-g21", "t-p2-g22",
];

// The other decomposition: every link a node APPEARS in, which is what its
// individual affinity sums (see affinity.node_affinity) and what an
// inspiration proc off it rolls against. A parent's four include the two
// below her and the parent pair — so a grandparent's single link is also
// inside its parent's number, and `p1-p2` is inside both parents'. That is
// why these don't sum to the total and the map doesn't show them.
//
// The trainee has none: it is in every link and a slot in none.
export const NODE_LINKS: readonly (readonly string[])[] = [
  [],
  ["t-p1", "t-p1-g11", "t-p1-g12", "p1-p2"],
  ["t-p2", "t-p2-g21", "t-p2-g22", "p1-p2"],
  ["t-p1-g11"],
  ["t-p1-g12"],
  ["t-p2-g21"],
  ["t-p2-g22"],
];
export const nodeOfAffinitySlot = (id: AffinitySlotId): number =>
  AFFINITY_SLOTS.indexOf(id) + 1;

// The trainee is in every link, so it reads as implicit and the labels name
// the other side(s) — "Parent 1 · GP 1-1" is the T·P1·G11 triple.
export const LINK_LABELS: Record<string, string> = {
  "t-p1": "Trainee · Parent 1",
  "t-p2": "Trainee · Parent 2",
  "p1-p2": "Parent 1 · Parent 2",
  "t-p1-g11": "Parent 1 · GP 1-1",
  "t-p1-g12": "Parent 1 · GP 1-2",
  "t-p2-g21": "Parent 2 · GP 2-1",
  "t-p2-g22": "Parent 2 · GP 2-2",
};

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
  // A roster pick's OWN letters, as trained. When set they ARE the node's
  // aptitudes — the career that produced them already consumed whatever her
  // parents passed down, so re-applying the bracket math on top would count
  // the same inheritance twice. Null on catalog picks (a card, not a horse)
  // and on lineage slots (the dump gives its members no aptitudes).
  aptitudes: AptitudeLetters | null;
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
  aptitudes: null,
});

export interface Design {
  id: number | null; // null until first saved
  name: string;
  named: (SlotValue | null)[]; // length 7, breadth-first; [0] = trainee
  sparks: (DeepSlot | null)[]; // length 24, tree indices 7–30
}

export const emptyDesign = (): Design => ({
  id: null,
  name: "",
  named: Array<SlotValue | null>(NAMED_COUNT).fill(null),
  sparks: Array<DeepSlot | null>(SPARK_COUNT).fill(null),
});

// ---------- reading and writing nodes ----------

// The pink spark at any tree index — a named member's typed pink, or the
// pink half of a deep slot. Null when a deep slot holds only a character,
// which is why every consumer of this can stay exactly as it was: "no pink
// here" already meant "contributes nothing to the brackets".
export function sparkAt(design: Design, i: number): PinkSpark | null {
  if (i < NAMED_COUNT) return design.named[i]?.spark ?? null;
  const slot = design.sparks[i - NAMED_COUNT];
  return slot?.aptitude == null || slot.stars == null
    ? null
    : { aptitude: slot.aptitude, stars: slot.stars };
}

// Who a deep slot is, if anyone. Named nodes keep identity in their own
// fields, so this only answers for generations 3 and 4.
export function deepCardAt(design: Design, i: number): number | null {
  return i < NAMED_COUNT ? null : (design.sparks[i - NAMED_COUNT]?.card_id ?? null);
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
  // Deep slot: replace the pink half, keeping whoever is in it. Clearing the
  // pink off a slot with nobody in it prunes it back to null, so an
  // untouched node never persists as a husk — the same rule the named
  // slots follow, and what keeps the unsaved-changes check honest.
  const card = design.sparks[i - NAMED_COUNT]?.card_id ?? null;
  return withDeep(
    design,
    i,
    spark === null
      ? card === null
        ? null
        : { card_id: card }
      : { aptitude: spark.aptitude, stars: spark.stars, ...(card === null ? {} : { card_id: card }) }
  );
}

// Replace a deep slot wholesale.
export function withDeep(design: Design, i: number, slot: DeepSlot | null): Design {
  const sparks = design.sparks.slice();
  sparks[i - NAMED_COUNT] = slot;
  return { ...design, sparks };
}

// Set (or drop) who a deep slot is, keeping its pink. Dropping the character
// off a slot with no pink prunes it away, as clearing the pink does.
export function withDeepCard(design: Design, i: number, cardId: number | null): Design {
  const slot = design.sparks[i - NAMED_COUNT];
  const pink = slot?.aptitude == null || slot.stars == null ? null : slot;
  if (cardId === null) {
    return withDeep(design, i, pink === null ? null : { aptitude: pink.aptitude, stars: pink.stars });
  }
  return withDeep(
    design,
    i,
    pink === null
      ? { card_id: cardId }
      : { aptitude: pink.aptitude, stars: pink.stars, card_id: cardId }
  );
}

// ---------- game-rule mirror ----------
// Grey-out reasons for the picker, generalized over the tree arithmetic and
// applied at every depth — generations 3 and 4 name characters now, so the
// same two rules reach them: no node repeats the one above it, and two nodes
// sharing a parent differ. The server stays the authority (its 422 still
// surfaces in the toast); this only spares obviously dead clicks.
// Deliberately absent: a grandparent repeating the TRAINEE's chara — the
// game allows it.
//
// `replacesBranch` is set for a roster pull, which overwrites the target's
// whole subtree rather than just the node. The descendant rule below is the
// one that differs: a horse sitting under the target stops being a conflict
// when the same action is about to overwrite her with the pull's own
// pedigree. Greying that out blocks a pull the server would accept, and says
// something false about why.
export function slotConflicts(
  design: Design,
  target: number,
  charaId: number,
  replacesBranch = false
): string | null {
  const at = (i: number) => charaAt(design, i);
  if (target > 0) {
    if (at(parentOf(target)) === charaId) {
      return target <= 2
        ? "A parent can't be the trainee's own character"
        : target < NAMED_COUNT
          ? "A grandparent can't repeat its own parent's character"
          : `Already ${nodeLabel(parentOf(target))} — a horse can't be its own parent`;
    }
    const sibling = target % 2 === 1 ? target + 1 : target - 1;
    if (at(sibling) === charaId) {
      return target <= 2
        ? "The two parents must be different characters"
        : target < NAMED_COUNT
          ? "This parent's two grandparents must be different"
          : `Already ${nodeLabel(sibling)} — a pair must be two different horses`;
    }
  }
  const [a, b] = kidsOf(target);
  if (!replacesBranch && a < NODE_COUNT && (at(a) === charaId || at(b) === charaId)) {
    return target === 0
      ? "Already a parent — the trainee must differ from both parents"
      : `Already one of ${nodeLabel(target)}'s own parents below — a horse can't be its own parent`;
  }
  return null;
}

// The character at any tree index. Named nodes carry chara_id outright; a
// generation-3/4 slot stores only a card, so its chara is derived — the same
// rule the server uses, since these checks exist to agree with it.
export function charaAt(design: Design, i: number): number | null {
  if (i < NAMED_COUNT) return design.named[i]?.chara_id ?? null;
  const card = deepCardAt(design, i);
  return card === null ? null : deriveCharaId(card);
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
export function pinkOf(factors: readonly Factor[]): PinkSpark | null {
  let best: PinkSpark | null = null;
  for (const f of factors) {
    const aptitude = PINK_KEY_APTITUDE[f.key];
    // Both checks: no non-pink factor uses a key in this range today, and
    // the kind is what keeps that true if one ever does.
    if (f.kind !== "pink" || aptitude === undefined || f.star < 1 || f.star > 3) continue;
    if (best === null || f.star > best.stars) best = { aptitude, stars: f.star };
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

// Which roster node, if any, owns this one — the nearest ancestor filled
// from your roster. Everything under a real veteran is that veteran's actual
// pedigree: her parents and their sparks are recorded history, not a plan,
// so they are read-only. Editing them would leave the tree asserting
// something false about a horse you own.
//
// Derived from the design rather than remembered from the pull, so it stays
// true after a reload, and stops applying the moment the roster node above
// is cleared or replaced — which is the way out.
export function lockedBy(design: Design, i: number): number | null {
  let j = i;
  while (j > 0) {
    j = parentOf(j);
    if (sourceAt(design, j) === "roster") return j;
  }
  return null;
}

// Where a node's character came from, at any depth. Named nodes always
// declare it; a deep slot declares it only when a pull placed it, so absent
// means hand-picked.
export function sourceAt(design: Design, i: number): SlotSource | null {
  if (i < NAMED_COUNT) return design.named[i]?.source ?? null;
  return design.sparks[i - NAMED_COUNT]?.source ?? null;
}

// The nodes a roster pick brought with it — its descendants, empty list for
// anything else. Clearing or replacing that pick takes them too: every one
// of them describes THAT veteran's ancestry, so leaving them would hang a
// pedigree under someone who doesn't have it, and leave it unlocked now that
// the veteran enforcing the lock is gone.
//
// Nothing hand-authored can be in there, which is why this needs no confirm:
// the branch was read-only from the moment of the pull, and the pull itself
// cleared whatever preceded it.
export function ownedBranch(design: Design, i: number): number[] {
  return sourceAt(design, i) === "roster" ? subtreeOf(i).slice(1) : [];
}

// Empty a set of nodes, named or deep.
export function clearNodes(design: Design, indices: readonly number[]): Design {
  let next = design;
  for (const i of indices) {
    next = i < NAMED_COUNT ? withNamed(next, i, null) : withDeep(next, i, null);
  }
  return next;
}

// Is this node's pink fixed? True for everything inside a locked branch, and
// also for the roster node at its head: that pink is the one the horse
// actually carries, so typing over it would be a fiction about a veteran you
// own. Her IDENTITY stays editable — swapping which veteran sits in the slot
// is a plan decision; rewriting her sparks is not.
export function sparkLocked(design: Design, i: number): boolean {
  return lockedBy(design, i) !== null || sourceAt(design, i) === "roster";
}

// Every node but the trainee takes a roster pull. The trainee is the horse
// you are about to train — not in your roster, that being the point of it,
// and a pull there would be the one click that empties all 31 nodes.
//
// A pull deeper in simply reaches less: it fills whatever the tree has room
// for beneath the target, which is one generation at gen 3 and nothing at
// gen 4. That falls out of pullTargets' bounds check rather than needing a
// rule of its own.
export const canPullInto = (i: number): boolean => i > 0;

// One node a pull would write. Named indices carry a whole slot; the deeper
// ones carry a bare spark (with the member's card_id, so the identity that
// arrived in the fetch isn't thrown away).
export interface PullWrite {
  index: number;
  slot?: SlotValue;
  deep?: DeepSlot;
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
// field: a pull records `lineage` on what it placed, so anything without one
// is yours — a typed pink, or a character you picked.
function handAuthored(design: Design, i: number): boolean {
  if (i < NAMED_COUNT) {
    const slot = design.named[i];
    return slot !== null && slot.source !== "lineage";
  }
  const slot = design.sparks[i - NAMED_COUNT];
  if (slot === null) return false;
  if (slot.source != null) return slot.source !== "lineage";
  // Rows written before deep slots recorded a source: back then a pull was
  // the only thing that set an identity, and it always left it beneath the
  // roster node that produced it.
  return slot.card_id == null || lockedBy(design, i) === null;
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
  // A dump's succession members carry no aptitude fields — only the veteran
  // record itself does. So a lineage node falls back to card base + brackets.
  aptitudes: null,
});

// Which dump field holds each aptitude, in the API's key order. The values
// are the game's 1..8 scale; `apt` maps them onto G..S.
const APTITUDE_FIELDS: Record<AptitudeKey, keyof Veteran> = {
  turf: "proper_ground_turf",
  dirt: "proper_ground_dirt",
  sprint: "proper_distance_short",
  mile: "proper_distance_mile",
  medium: "proper_distance_middle",
  long: "proper_distance_long",
  front: "proper_running_style_nige",
  pace: "proper_running_style_senko",
  late: "proper_running_style_sashi",
  end: "proper_running_style_oikomi",
};

// A trained veteran's actual letters, off her own dump record. These are
// what she finished her career with — inheritance, inspirations and any
// aptitude gained in training, all already in the number.
//
// Null when any field is off the 1..8 scale (`apt` degrades those to "-" or
// "?"). All ten letters or none: the server accepts only the real grades, so
// storing a placeholder would 422 the autosave for the whole design. Dropping
// them instead costs the slot its "as trained" mode and nothing else — it
// falls back to the card's base letters, which is what the same slot showed
// before this snapshot existed.
export function veteranAptitudes(v: Veteran): AptitudeLetters | null {
  const out = {} as AptitudeLetters;
  for (const key of APTITUDE_KEYS) {
    const letter = apt(v[APTITUDE_FIELDS[key]] as number);
    if (!isLetter(letter)) return null;
    out[key] = letter;
  }
  return out;
}

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
  const ownPink = pinkOf(veteran.factors);
  // A deep slot has room for a face and a pink and nothing else — no won
  // saddles, no trained_chara_id, no trained letters. None of those are read
  // below the grandparents: affinity scores the named triangle only, and the
  // bracket math reads stars. So the pull carries what fits, and the `source`
  // is what still marks the branch as recorded history.
  const writes: PullWrite[] = [
    target < NAMED_COUNT
      ? {
          index: target,
          slot: {
            source: "roster",
            chara_id: veteran.chara_id,
            card_id: veteran.card_id,
            win_saddle_ids: veteran.win_saddles,
            trained_chara_id: veteran.trained_chara_id,
            position_id: null,
            spark: ownPink,
            aptitudes: veteranAptitudes(veteran),
          },
        }
      : {
          index: target,
          deep: {
            card_id: veteran.card_id,
            source: "roster",
            ...(ownPink === null ? {} : { aptitude: ownPink.aptitude, stars: ownPink.stars }),
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
    // Below the grandparents there is nowhere to put a NAME, but the card id
    // still rides along at every depth the dump reaches: it's what draws the
    // character's icon on the map, which is how a deep slot is recognisable
    // at all. Generation 4 only ever gets one from a grandparent-level pull
    // — a parent-level pull has no data that deep and clears it instead.
    // A member with no pink still lands, as a face: that is real information
    // about who is there, and the slot now has somewhere to keep it.
    const pink = pinkOf(member.factors);
    writes.push({
      index,
      deep: {
        card_id: member.card_id,
        source: "lineage",
        ...(pink === null ? {} : { aptitude: pink.aptitude, stars: pink.stars }),
      },
    });
  }
  const written = new Set(writes.map((w) => w.index));
  const branch = subtreeOf(target);
  // Swapping one veteran for another is the action you just took, so the
  // node you aimed at isn't collateral and doesn't belong in the warning —
  // naming it would put a dialog on every re-pull saying only "the thing
  // you asked to replace will be replaced". It stays in the list when it
  // holds something you authored yourself: a catalog pick, or a typed pink
  // (which a roster pick can't have — its pink is the horse's own).
  const collateral = (i: number) =>
    handAuthored(design, i) && !(i === target && sourceAt(design, i) === "roster");
  return {
    writes,
    clears: branch.filter((i) => !written.has(i)),
    clobbers: branch.filter(collateral),
  };
}

export function applyPull(design: Design, plan: PullPlan): Design {
  // Clear first, then fill: the two sets are disjoint, so the order only
  // matters for readability, and "empty the branch, then populate it" is
  // what the rule actually says.
  let next = clearNodes(design, plan.clears);
  for (const w of plan.writes) {
    next = w.slot !== undefined
      ? withNamed(next, w.index, w.slot)
      : withDeep(next, w.index, w.deep ?? null);
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
        aptitudes: s.aptitudes,
      };

// The scoring request: the trainee's chara plus every filled ancestor in the
// top three generations, each with the won saddles snapshotted into the slot
// (never re-read from the roster — a veteran that leaves it keeps her win
// bonus). A node with a planned spark but no character yet is nobody, so it
// is omitted rather than sent as a slot the server would score as empty.
export function toAffinityRequest(design: Design): AffinityRequest {
  const req: AffinityRequest = { trainee_chara_id: design.named[0]?.chara_id ?? null };
  for (const id of AFFINITY_SLOTS) {
    const slot = design.named[nodeOfAffinitySlot(id)];
    if (slot?.chara_id == null) continue;
    req[id] = { chara_id: slot.chara_id, win_saddle_ids: slot.win_saddle_ids };
  }
  return req;
}

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
// The pink half. Both fields present and valid, or neither.
function pinkFromApi(raw: DeepSlot): PinkSpark | null {
  if (raw.aptitude == null && raw.stars == null) return null;
  const ok =
    raw.aptitude != null &&
    APTITUDE_KEYS.includes(raw.aptitude) &&
    typeof raw.stars === "number" &&
    Number.isInteger(raw.stars) &&
    raw.stars >= 1 &&
    raw.stars <= 3;
  if (!ok) throw new Error("malformed pink spark");
  return { aptitude: raw.aptitude as AptitudeKey, stars: raw.stars as number };
}

// A named slot's spark, which must be a real pink — identity lives in the
// slot's own fields there, so a face-only value is a shape this client
// doesn't understand rather than a legal spark.
function sparkFromApi(raw: DeepSlot | null | undefined): PinkSpark | null {
  if (raw === null || raw === undefined) return null;
  const pink = pinkFromApi(raw);
  if (pink === null) throw new Error("a named slot's spark needs an aptitude");
  return pink;
}

// A generation-3/4 slot: a pink, a character, or both. Neither ⇒ the row
// should have been written as null, so it's malformed rather than empty.
function deepFromApi(raw: DeepSlot | null | undefined): DeepSlot | null {
  if (raw === null || raw === undefined) return null;
  const pink = pinkFromApi(raw);
  const card = raw.card_id;
  if (card !== null && card !== undefined && !Number.isInteger(card)) {
    throw new Error("malformed deep slot identity");
  }
  const cardId = card ?? null;
  if (pink === null && cardId === null) throw new Error("malformed deep slot");
  const source = raw.source ?? null;
  if (source !== null && source !== "roster" && source !== "lineage") {
    throw new Error(`unsupported slot source ${String(source)}`);
  }
  if (source !== null && cardId === null) throw new Error("a pulled slot needs a character");
  return {
    ...(pink === null ? {} : { aptitude: pink.aptitude, stars: pink.stars }),
    ...(cardId === null ? {} : { card_id: cardId }),
    ...(source === null ? {} : { source }),
  };
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
    aptitudes: lettersFromApi(raw.aptitudes, source),
  };
}

// A roster pick's stored letters. Absent on every catalog and lineage slot,
// and on every row written before roster pulls existed, so undefined is
// normal — but a partial or mislabelled set is a shape this client doesn't
// understand, and silently dropping it would show card base letters for a
// horse whose real ones were right there.
function lettersFromApi(
  raw: AptitudeLetters | null | undefined,
  source: SlotSource
): AptitudeLetters | null {
  if (raw === null || raw === undefined) return null;
  if (source !== "roster") throw new Error("only a roster slot carries its own aptitudes");
  const out = {} as AptitudeLetters;
  for (const key of APTITUDE_KEYS) {
    const letter = raw[key];
    // The same ten-keys-of-eight-grades rule the server enforces on write —
    // these two must agree exactly, or a document it accepts is one this
    // client can never open again.
    if (!isLetter(letter)) throw new Error("malformed aptitudes");
    out[key] = letter;
  }
  return out;
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
    sparks: slots.sparks.map(deepFromApi),
  };
};
