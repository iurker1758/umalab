import { beforeEach, describe, expect, it } from "vitest";
import {
  NAMED_COUNT,
  NODE_COUNT,
  SPARK_COUNT,
  canPullInto,
  canUnselect,
  catalogSlot,
  charaAt,
  clearNodes,
  copyName,
  deriveCharaId,
  emptyDesign,
  factorsOf,
  fromApi,
  genOf,
  halfOf,
  kidsOf,
  lockedBy,
  nextUntitledName,
  nodeLabel,
  ownedBranch,
  parentOf,
  pinkOf,
  planPull,
  applyPull,
  pullTargets,
  readOpenId,
  slotConflicts,
  sourceAt,
  sparkAt,
  sparkLocked,
  subtreeOf,
  toAffinityRequest,
  toApi,
  veteranAptitudes,
  windowIndices,
  withFactors,
  withSpark,
  withoutCharacter,
  writeOpenId,
  DESIGN_STORE,
  UNTITLED,
  type Design,
} from "./blueprint";
import type { Blueprint } from "./api";
import { designWith, factor, member, slot, stubLocalStorage, veteran } from "./testing";

// ---------- tree arithmetic ----------

describe("the tree's shape", () => {
  it("is 7 named nodes over 24 anonymous spark slots", () => {
    expect(NAMED_COUNT).toBe(7);
    expect(SPARK_COUNT).toBe(24);
    expect(NODE_COUNT).toBe(31);
  });

  it("wires kids to 2i+1 / 2i+2, and back", () => {
    for (let i = 0; i < NODE_COUNT; i++) {
      for (const kid of kidsOf(i)) {
        if (kid < NODE_COUNT) expect(parentOf(kid)).toBe(i);
      }
    }
  });

  it("puts the generations where the labels say they are", () => {
    expect(genOf(0)).toBe(0);
    expect([1, 2].map(genOf)).toEqual([1, 1]);
    expect([3, 6].map(genOf)).toEqual([2, 2]);
    expect([7, 14].map(genOf)).toEqual([3, 3]);
    expect([15, 30].map(genOf)).toEqual([4, 4]);
  });

  it("assigns every node below the trainee to one parent's half", () => {
    expect(halfOf(0)).toBe(0);
    expect(subtreeOf(1).every((i) => halfOf(i) === 1)).toBe(true);
    expect(subtreeOf(2).every((i) => halfOf(i) === 2)).toBe(true);
  });

  it("labels the named nodes and numbers the deep ones by generation", () => {
    expect(nodeLabel(0)).toBe("Trainee");
    expect(nodeLabel(6)).toBe("Grandparent 2-2");
    expect(nodeLabel(7)).toBe("Sparks 3-1");
    expect(nodeLabel(14)).toBe("Sparks 3-8");
    expect(nodeLabel(15)).toBe("Sparks 4-1");
    expect(nodeLabel(30)).toBe("Sparks 4-16");
  });

  it("gives a node the six slots below it, and stops at the tree's edge", () => {
    expect(windowIndices(1)).toEqual([3, 4, 7, 8, 9, 10]);
    // A generation-3 node has kids but no grandkids inside the tree.
    expect(windowIndices(7)).toEqual([15, 16]);
    expect(windowIndices(15)).toEqual([]);
  });

  it("walks a branch breadth-first from the node itself", () => {
    expect(subtreeOf(3)).toEqual([3, 7, 8, 15, 16, 17, 18]);
    expect(subtreeOf(15)).toEqual([15]);
  });
});

// ---------- pull bounds ----------

describe("pullTargets", () => {
  it("fills two kids and four grandkids from a parent-level pull", () => {
    expect(pullTargets(1)).toEqual([
      { index: 3, position: 10 },
      { index: 4, position: 20 },
      { index: 7, position: 11 },
      { index: 8, position: 12 },
      { index: 9, position: 21 },
      { index: 10, position: 22 },
    ]);
  });

  it("maps a blueprint grandparent to the veteran's PARENT slot, never her grandparent", () => {
    // The classic off-by-one-generation error.
    expect(pullTargets(3).map((t) => t.position)).toEqual([10, 20, 11, 12, 21, 22]);
    expect(pullTargets(3)[0]).toEqual({ index: 7, position: 10 });
  });

  it("fills only two from a generation-3 pull — the tree has no room below", () => {
    expect(pullTargets(7)).toEqual([
      { index: 15, position: 10 },
      { index: 16, position: 20 },
    ]);
  });

  it("fills nothing from a generation-4 pull", () => {
    expect(pullTargets(15)).toEqual([]);
    expect(pullTargets(30)).toEqual([]);
  });

  it("still allows the pull itself at every depth but the trainee", () => {
    expect(canPullInto(0)).toBe(false);
    for (let i = 1; i < NODE_COUNT; i++) expect(canPullInto(i)).toBe(true);
  });
});

describe("deriveCharaId", () => {
  it("strips the outfit digits, and the extra prefix on a rarity-0 NPC copy", () => {
    expect(deriveCharaId(100_101)).toBe(1001);
    expect(deriveCharaId(9_100_101)).toBe(1001);
  });
});

// ---------- decoding a dump member ----------

describe("pinkOf", () => {
  it("reads the aptitude out of the key and the stars out of the star field", () => {
    expect(pinkOf([factor({ kind: "pink", key: 32, star: 2 })])).toEqual({
      aptitude: "mile",
      stars: 2,
    });
    expect(pinkOf([factor({ kind: "pink", key: 11, star: 1 })])).toEqual({
      aptitude: "turf",
      stars: 1,
    });
  });

  it("takes the strongest rather than the first", () => {
    expect(
      pinkOf([
        factor({ kind: "pink", key: 32, star: 1 }),
        factor({ kind: "pink", key: 34, star: 3 }),
      ])
    ).toEqual({ aptitude: "long", stars: 3 });
  });

  it("wants both the kind and a known key", () => {
    expect(pinkOf([factor({ kind: "white", key: 32, star: 3 })])).toBeNull();
    expect(pinkOf([factor({ kind: "pink", key: 99, star: 3 })])).toBeNull();
  });

  it("rejects a star count off the 1..3 scale", () => {
    expect(pinkOf([factor({ kind: "pink", key: 32, star: 0 })])).toBeNull();
    expect(pinkOf([factor({ kind: "pink", key: 32, star: 4 })])).toBeNull();
  });

  it("is null for a member with nothing to read", () => {
    expect(pinkOf([])).toBeNull();
  });
});

describe("factorsOf", () => {
  it("keeps the four non-pink kinds and drops everything else", () => {
    const out = factorsOf([
      factor({ kind: "white", key: 700, star: 1 }),
      factor({ kind: "unique", key: 100_101, star: 2 }),
      factor({ kind: "race", key: 5, star: 3 }),
      factor({ kind: "scenario", key: 6, star: 1 }),
      factor({ kind: "blue", key: 1, star: 3 }),
      factor({ kind: "pink", key: 32, star: 3 }),
      factor({ kind: "other", key: 9, star: 3 }),
    ]);
    expect(out.map((f) => f.kind).sort()).toEqual(["race", "scenario", "unique", "white"]);
  });

  it("dedupes on kind AND key, keeping the strongest", () => {
    const out = factorsOf([
      factor({ kind: "white", key: 700, star: 1 }),
      factor({ kind: "white", key: 700, star: 3 }),
      factor({ kind: "race", key: 700, star: 2 }),
    ]);
    expect(out).toEqual([
      { kind: "white", key: 700, stars: 3 },
      { kind: "race", key: 700, stars: 2 },
    ]);
  });

  it("sorts strongest first, then by kind and key", () => {
    const out = factorsOf([
      factor({ kind: "white", key: 9, star: 1 }),
      factor({ kind: "white", key: 2, star: 1 }),
      factor({ kind: "race", key: 9, star: 1 }),
      factor({ kind: "white", key: 1, star: 3 }),
    ]);
    expect(out.map((f) => `${f.kind}:${f.key}`)).toEqual([
      "white:1",
      "race:9",
      "white:2",
      "white:9",
    ]);
  });

  it("drops a star count off the scale rather than storing it", () => {
    expect(factorsOf([factor({ kind: "white", key: 1, star: 0 })])).toEqual([]);
    expect(factorsOf([factor({ kind: "white", key: 1, star: 4 })])).toEqual([]);
  });
});

describe("veteranAptitudes", () => {
  it("reads all ten letters off her own record", () => {
    const v = veteran({ proper_ground_turf: 8, proper_distance_short: 1 });
    expect(veteranAptitudes(v)).toMatchObject({ turf: "S", sprint: "G", mile: "A" });
  });

  it("is all ten or none — a field off the scale drops the whole set", () => {
    expect(veteranAptitudes(veteran({ proper_ground_dirt: 0 }))).toBeNull();
    expect(veteranAptitudes(veteran({ proper_ground_dirt: 9 }))).toBeNull();
  });
});

// ---------- reading and writing nodes ----------

describe("sparkAt", () => {
  it("reads a named node's typed pink and a deep slot's pink half", () => {
    const design = designWith({
      1: catalogSlot(1001, 100_101, { aptitude: "mile", stars: 3 }),
      7: { aptitude: "turf", stars: 2 },
    });
    expect(sparkAt(design, 1)).toEqual({ aptitude: "mile", stars: 3 });
    expect(sparkAt(design, 7)).toEqual({ aptitude: "turf", stars: 2 });
  });

  it("is null for an empty node, and for a deep slot holding only a face", () => {
    const design = designWith({ 8: { card_id: 100_101 } });
    expect(sparkAt(design, 1)).toBeNull();
    expect(sparkAt(design, 8)).toBeNull();
    expect(sparkAt(design, 9)).toBeNull();
  });

  it("is null for half a spark, which reads as a different one", () => {
    expect(sparkAt(designWith({ 7: { aptitude: "turf" } }), 7)).toBeNull();
    expect(sparkAt(designWith({ 7: { stars: 2 } }), 7)).toBeNull();
  });
});

describe("withSpark / withFactors / withoutCharacter prune rather than leave husks", () => {
  const pink = { aptitude: "mile", stars: 3 } as const;

  it("creates a spark-only named slot on an empty node", () => {
    const d = withSpark(emptyDesign(), 1, pink);
    expect(d.named[1]).toMatchObject({ source: "catalog", chara_id: null, spark: pink });
  });

  it("leaves an empty node alone when the spark cleared is already absent", () => {
    const d = emptyDesign();
    expect(withSpark(d, 1, null)).toBe(d);
  });

  it("prunes a node back to null once nothing is left on it", () => {
    const one = withSpark(emptyDesign(), 1, pink);
    expect(withSpark(one, 1, null).named[1]).toBeNull();
  });

  it("keeps a node whose whites are the plan when its pink is cleared", () => {
    const planned = withFactors(withSpark(emptyDesign(), 1, pink), 1, [
      { kind: "white", key: 700, stars: 3 },
    ]);
    expect(withSpark(planned, 1, null).named[1]).toMatchObject({ spark: null });
  });

  it("prunes a deep slot with nobody in it, and keeps one with a face", () => {
    const withFace = designWith({ 7: { aptitude: "turf", stars: 1, card_id: 100_101 } });
    expect(withSpark(withFace, 7, null).sparks[0]).toEqual({ card_id: 100_101 });
    const bare = designWith({ 7: { aptitude: "turf", stars: 1 } });
    expect(withSpark(bare, 7, null).sparks[0]).toBeNull();
  });

  it("takes the face off a named node while keeping everything planned on it", () => {
    const cast = designWith({
      1: slot({ spark: pink, factors: [{ kind: "white", key: 700, stars: 1 }] }),
    });
    expect(withoutCharacter(cast, 1).named[1]).toMatchObject({
      source: "catalog",
      chara_id: null,
      card_id: null,
      spark: pink,
      factors: [{ kind: "white", key: 700, stars: 1 }],
    });
  });

  it("prunes a node that had nothing but a face", () => {
    const cast = designWith({ 1: slot({}) });
    expect(withoutCharacter(cast, 1).named[1]).toBeNull();
  });
});

// ---------- source-derived locking ----------

describe("lockedBy and what follows from it", () => {
  // Parent 1 is a real veteran, so her whole branch is recorded history.
  const pulled = designWith({
    1: slot({ source: "roster", trained_chara_id: 9 }),
    3: slot({ source: "lineage", trained_chara_id: 9, position_id: 10 }),
    7: { card_id: 100_101, source: "lineage" },
    2: slot({ source: "catalog" }),
  });

  it("locks everything under the roster node, at every depth", () => {
    expect(lockedBy(pulled, 3)).toBe(1);
    expect(lockedBy(pulled, 7)).toBe(1);
    expect(lockedBy(pulled, 15)).toBe(1);
  });

  it("does not lock the roster node itself, whose identity stays editable", () => {
    expect(lockedBy(pulled, 1)).toBeNull();
  });

  it("leaves the other half of the tree alone", () => {
    expect(lockedBy(pulled, 2)).toBeNull();
    expect(lockedBy(pulled, 5)).toBeNull();
  });

  it("is derived, so clearing the roster node above unlocks the branch", () => {
    const cleared = clearNodes(pulled, [1]);
    expect(lockedBy(cleared, 3)).toBeNull();
  });

  it("fixes the pink on the roster node too, but not its identity", () => {
    expect(sparkLocked(pulled, 1)).toBe(true);
    expect(sparkLocked(pulled, 3)).toBe(true);
    expect(sparkLocked(pulled, 2)).toBe(false);
  });

  it("reads a deep slot's source, where absent means hand-picked", () => {
    expect(sourceAt(pulled, 7)).toBe("lineage");
    expect(sourceAt(designWith({ 7: { card_id: 1 } }), 7)).toBeNull();
  });

  it("owns the branch below a roster pick, and nothing below anything else", () => {
    expect(ownedBranch(pulled, 1)).toEqual(subtreeOf(1).slice(1));
    expect(ownedBranch(pulled, 2)).toEqual([]);
    expect(ownedBranch(pulled, 3)).toEqual([]);
  });
});

describe("canUnselect", () => {
  const pink = { aptitude: "mile", stars: 3 } as const;

  it("offers it on a hand-picked node that has something to keep", () => {
    expect(canUnselect(designWith({ 1: slot({ spark: pink }) }), 1)).toBe(true);
    expect(
      canUnselect(designWith({ 1: slot({ factors: [{ kind: "white", key: 1, stars: 1 }] }) }), 1)
    ).toBe(true);
  });

  it("withholds it when the node is only a face — that is Clear", () => {
    expect(canUnselect(designWith({ 1: slot({}) }), 1)).toBe(false);
    expect(canUnselect(designWith({ 0: slot({}) }), 0)).toBe(false);
  });

  it("withholds it on anything a pull placed, or anything under one", () => {
    const pulled = designWith({
      1: slot({ source: "roster", trained_chara_id: 9, spark: pink }),
      3: slot({ source: "lineage", trained_chara_id: 9, position_id: 10, spark: pink }),
    });
    expect(canUnselect(pulled, 1)).toBe(false);
    expect(canUnselect(pulled, 3)).toBe(false);
  });

  it("offers it on a hand-annotated deep slot only", () => {
    const hand = designWith({ 7: { aptitude: "turf", stars: 1, card_id: 100_101 } });
    expect(canUnselect(hand, 7)).toBe(true);
    const noFace = designWith({ 7: { aptitude: "turf", stars: 1 } });
    expect(canUnselect(noFace, 7)).toBe(false);
    const pulled = designWith({ 7: { aptitude: "turf", stars: 1, card_id: 1, source: "lineage" } });
    expect(canUnselect(pulled, 7)).toBe(false);
  });
});

// ---------- the game-rule mirror ----------

describe("slotConflicts", () => {
  const design = designWith({
    0: slot({ chara_id: 1000 }),
    1: slot({ chara_id: 1001 }),
    2: slot({ chara_id: 1002 }),
    3: slot({ chara_id: 1003 }),
  });

  it("stops a node repeating the one directly above it", () => {
    expect(slotConflicts(design, 1, 1000)).toMatch(/trainee/i);
    expect(slotConflicts(design, 3, 1001)).toMatch(/own parent/i);
  });

  it("stops two nodes sharing a parent being the same character", () => {
    expect(slotConflicts(design, 2, 1001)).toMatch(/different/i);
    expect(slotConflicts(design, 4, 1003)).toMatch(/different/i);
  });

  it("stops a node repeating a character already below it", () => {
    expect(slotConflicts(design, 0, 1001)).toMatch(/must differ/i);
    expect(slotConflicts(design, 1, 1003)).toMatch(/own parents below/i);
  });

  it("allows a grandparent to repeat the trainee, which the game allows", () => {
    expect(slotConflicts(design, 4, 1000)).toBeNull();
  });

  it("does not call a descendant a conflict when the pull is about to replace her", () => {
    expect(slotConflicts(design, 1, 1003, true)).toBeNull();
    // The rules that still apply either way.
    expect(slotConflicts(design, 1, 1000, true)).not.toBeNull();
  });

  it("derives a deep slot's character from its card, as the server does", () => {
    const deep = designWith({ 7: { card_id: 100_101 } });
    expect(charaAt(deep, 7)).toBe(1001);
    expect(charaAt(deep, 8)).toBeNull();
  });
});

// ---------- planning and applying a pull ----------

const bred = veteran({
  chara_id: 2001,
  card_id: 200_101,
  trained_chara_id: 900_000_007,
  win_saddles: [1, 2],
  factors: [
    factor({ kind: "pink", key: 32, star: 3 }),
    factor({ kind: "white", key: 700, star: 2 }),
  ],
  lineage: [
    member({
      position_id: 10,
      chara_id: 3001,
      card_id: 300_101,
      factors: [factor({ kind: "pink", key: 11, star: 2 })],
    }),
    member({ position_id: 20, chara_id: 3002, card_id: 300_201, factors: [] }),
    member({ position_id: 11, chara_id: 4001, card_id: 400_101, factors: [] }),
    // 12 is deliberately absent — an unbred parent.
    member({ position_id: 21, chara_id: 4003, card_id: 400_301, factors: [] }),
    member({ position_id: 22, chara_id: 4004, card_id: 400_401, factors: [] }),
  ],
});

describe("planPull", () => {
  it("refuses the trainee", () => {
    expect(() => planPull(emptyDesign(), 0, bred)).toThrow();
  });

  it("writes the veteran as a roster slot, with her own record snapshotted", () => {
    const plan = planPull(emptyDesign(), 1, bred);
    expect(plan.writes[0]).toMatchObject({
      index: 1,
      slot: {
        source: "roster",
        chara_id: 2001,
        card_id: 200_101,
        win_saddle_ids: [1, 2],
        trained_chara_id: 900_000_007,
        spark: { aptitude: "mile", stars: 3 },
        factors: [{ kind: "white", key: 700, stars: 2 }],
      },
    });
    expect(plan.writes[0].slot?.aptitudes).not.toBeNull();
  });

  it("fills the two generations the dump reaches, and empties the rest", () => {
    const plan = planPull(emptyDesign(), 1, bred);
    expect(plan.writes.map((w) => w.index)).toEqual([1, 3, 4, 7, 9, 10]);
    // 8 is the missing position-12 member; everything at generation 4 is
    // beyond what a parent-level pull can know.
    expect(plan.clears).toContain(8);
    expect(plan.clears).toEqual(expect.arrayContaining(subtreeOf(1).filter((i) => i >= 15)));
    expect([...plan.writes.map((w) => w.index), ...plan.clears].sort((a, b) => a - b)).toEqual(
      subtreeOf(1).sort((a, b) => a - b)
    );
  });

  it("marks a lineage node with the position it came from", () => {
    // Named lineage slots are the two kids; below them the tree has no room
    // for a name, so those become deep slots (covered next).
    const plan = planPull(emptyDesign(), 1, bred);
    expect(plan.writes.find((w) => w.index === 3)?.slot).toMatchObject({
      source: "lineage",
      position_id: 10,
      chara_id: 3001,
      trained_chara_id: 900_000_007,
      spark: { aptitude: "turf", stars: 2 },
      aptitudes: null,
    });
    expect(plan.writes.find((w) => w.index === 7)?.slot).toBeUndefined();
    expect(plan.writes.find((w) => w.index === 7)?.deep).toMatchObject({
      card_id: 400_101,
      source: "lineage",
    });
  });

  it("carries a face and a pink into a deep slot, and nothing else", () => {
    const plan = planPull(emptyDesign(), 3, bred);
    expect(plan.writes.find((w) => w.index === 7)?.deep).toEqual({
      card_id: 300_101,
      source: "lineage",
      aptitude: "turf",
      stars: 2,
    });
    // A member with no pink still lands as a face.
    expect(plan.writes.find((w) => w.index === 8)?.deep).toEqual({
      card_id: 300_201,
      source: "lineage",
    });
  });

  it("writes the target itself as a deep slot when it is one", () => {
    const plan = planPull(emptyDesign(), 7, bred);
    expect(plan.writes[0].deep).toEqual({
      card_id: 200_101,
      source: "roster",
      aptitude: "mile",
      stars: 3,
    });
  });

  it("names only hand-authored collateral, never an empty node", () => {
    const plan = planPull(emptyDesign(), 1, bred);
    expect(plan.clobbers).toEqual([]);
  });

  it("names a catalog pick and a typed spark anywhere in the branch", () => {
    const design = designWith({
      3: slot({ chara_id: 5001 }),
      9: { aptitude: "turf", stars: 1 },
    });
    expect(planPull(design, 1, bred).clobbers).toEqual([3, 9]);
  });

  it("does not name the node you aimed at when it is already a roster pick", () => {
    const design = designWith({ 1: slot({ source: "roster", trained_chara_id: 9 }) });
    expect(planPull(design, 1, bred).clobbers).toEqual([]);
  });

  it("does name it when it holds something you authored", () => {
    const design = designWith({ 1: slot({ chara_id: 5001 }) });
    expect(planPull(design, 1, bred).clobbers).toEqual([1]);
  });

  it("does not name what an earlier pull placed", () => {
    const design = designWith({
      3: slot({ source: "lineage", trained_chara_id: 9, position_id: 10 }),
      9: { card_id: 100_101, source: "lineage" },
    });
    expect(planPull(design, 1, bred).clobbers).toEqual([]);
  });
});

describe("applyPull", () => {
  it("empties the branch and fills what the dump reached", () => {
    const before = designWith({
      1: slot({ chara_id: 5001 }),
      8: { aptitude: "long", stars: 3 },
      15: { aptitude: "long", stars: 3 },
      // The other half of the tree must be untouched.
      2: slot({ chara_id: 5002 }),
    });
    const after = applyPull(before, planPull(before, 1, bred));
    expect(after.named[1]).toMatchObject({ source: "roster", chara_id: 2001 });
    expect(after.named[3]).toMatchObject({ source: "lineage", chara_id: 3001 });
    expect(sparkAt(after, 8)).toBeNull();
    expect(sparkAt(after, 15)).toBeNull();
    expect(after.named[2]).toMatchObject({ chara_id: 5002 });
  });

  it("locks everything it placed under the node it placed it below", () => {
    const after = applyPull(emptyDesign(), planPull(emptyDesign(), 1, bred));
    expect(lockedBy(after, 3)).toBe(1);
    expect(lockedBy(after, 7)).toBe(1);
    expect(sparkLocked(after, 1)).toBe(true);
  });

  it("leaves the design it was given untouched", () => {
    const before = designWith({ 1: slot({ chara_id: 5001 }) });
    applyPull(before, planPull(before, 1, bred));
    expect(before.named[1]).toMatchObject({ chara_id: 5001 });
    expect(before.named[3]).toBeNull();
  });
});

// ---------- the document, in and out ----------

const blueprint = (design: Design): Blueprint => ({
  id: 1,
  ...toApi(design),
  created_at: "2026-01-01T00:00:00",
  updated_at: "2026-01-01T00:00:00",
});

describe("fromApi", () => {
  it("round-trips a design through the wire shape", () => {
    const design = applyPull(emptyDesign(), planPull(emptyDesign(), 1, bred));
    design.name = "Mile Plan";
    const back = fromApi(blueprint(design));
    expect(back.named).toEqual(design.named);
    expect(back.sparks).toEqual(design.sparks);
    expect(back.name).toBe("Mile Plan");
  });

  it("round-trips a spark-only node and a hand-annotated deep slot", () => {
    let design = withSpark(emptyDesign(), 1, { aptitude: "mile", stars: 3 });
    design = withFactors(design, 1, [{ kind: "white", key: 700, stars: 2 }]);
    design.sparks[0] = { aptitude: "turf", stars: 1, card_id: 100_101 };
    expect(fromApi(blueprint(design))).toMatchObject({
      named: design.named,
      sparks: design.sparks,
    });
  });

  // Every one of these must throw rather than parse as a blank or shifted
  // design — silently-blank is the data-loss shape DECISIONS.md #26 is about.
  it.each([
    ["no slots document at all", null],
    ["a named array of the wrong length", { named: Array(6).fill(null), sparks: Array(24).fill(null) }],
    ["a sparks array of the wrong length", { named: Array(7).fill(null), sparks: Array(23).fill(null) }],
    ["a missing sparks array", { named: Array(7).fill(null) }],
  ])("throws on %s", (_what, slots) => {
    expect(() => fromApi({ ...blueprint(emptyDesign()), slots } as Blueprint)).toThrow();
  });

  const withNamedRaw = (raw: unknown) => {
    const bp = blueprint(emptyDesign());
    (bp.slots.named as unknown[])[1] = raw;
    return bp;
  };
  const withDeepRaw = (raw: unknown) => {
    const bp = blueprint(emptyDesign());
    (bp.slots.sparks as unknown[])[0] = raw;
    return bp;
  };

  it.each([
    ["an unknown source", { source: "imported", chara_id: 1, card_id: 1 }],
    ["a roster slot with no trained_chara_id", { source: "roster", chara_id: 1, card_id: 1 }],
    [
      "a lineage slot with no position_id",
      { source: "lineage", chara_id: 1, card_id: 1, trained_chara_id: 9 },
    ],
    ["won-saddle ids that aren't integers", { source: "catalog", chara_id: 1, card_id: 1, win_saddle_ids: ["x"] }],
    ["half an identity", { source: "catalog", chara_id: 1, card_id: null }],
    [
      "a spark-only slot that isn't a catalog pick",
      { source: "roster", chara_id: null, card_id: null, trained_chara_id: 9, spark: { aptitude: "mile", stars: 3 } },
    ],
    ["a slot with neither identity nor spark", { source: "catalog", chara_id: null, card_id: null }],
    [
      "a named slot whose spark is a bare face",
      { source: "catalog", chara_id: 1, card_id: 1, spark: { card_id: 2 } },
    ],
    [
      "a star count off the scale",
      { source: "catalog", chara_id: 1, card_id: 1, spark: { aptitude: "mile", stars: 4 } },
    ],
    [
      "an aptitude the client doesn't know",
      { source: "catalog", chara_id: 1, card_id: 1, spark: { aptitude: "jump", stars: 1 } },
    ],
    [
      "aptitudes on a slot that isn't a roster pick",
      { source: "catalog", chara_id: 1, card_id: 1, aptitudes: {} },
    ],
    [
      "a malformed spark list",
      { source: "catalog", chara_id: 1, card_id: 1, factors: [{ kind: "blue", key: 1, stars: 1 }] },
    ],
    [
      "the same spark twice",
      {
        source: "catalog",
        chara_id: 1,
        card_id: 1,
        factors: [
          { kind: "white", key: 7, stars: 1 },
          { kind: "white", key: 7, stars: 3 },
        ],
      },
    ],
  ])("throws on a named slot with %s", (_what, raw) => {
    expect(() => fromApi(withNamedRaw(raw))).toThrow();
  });

  it("throws on a roster slot whose stored letters are partial", () => {
    expect(() =>
      fromApi(
        withNamedRaw({
          source: "roster",
          chara_id: 1,
          card_id: 1,
          trained_chara_id: 9,
          aptitudes: { turf: "A" },
        })
      )
    ).toThrow();
  });

  it.each([
    ["neither a pink nor a face", {}],
    ["half a pink", { aptitude: "mile" }],
    ["a non-integer card", { card_id: 1.5 }],
    ["an unknown source", { card_id: 1, source: "imported" }],
    ["a source but nobody in the slot", { aptitude: "mile", stars: 1, source: "roster" }],
  ])("throws on a deep slot with %s", (_what, raw) => {
    expect(() => fromApi(withDeepRaw(raw))).toThrow();
  });

  it("reads a slot written before non-pink sparks existed as carrying none", () => {
    const back = fromApi(withNamedRaw({ source: "catalog", chara_id: 1, card_id: 1 }));
    expect(back.named[1]).toMatchObject({ factors: [], aptitudes: null, spark: null });
  });
});

describe("toAffinityRequest", () => {
  it("sends only the filled named nodes, with their snapshotted saddles", () => {
    const design = designWith({
      0: slot({ chara_id: 1000 }),
      1: slot({ chara_id: 1001, win_saddle_ids: [4] }),
      // A planned spark with nobody in it is nobody, and is omitted.
      2: catalogSlot(null, null, { aptitude: "mile", stars: 3 }),
    });
    expect(toAffinityRequest(design)).toEqual({
      trainee_chara_id: 1000,
      p1: { chara_id: 1001, win_saddle_ids: [4] },
    });
  });
});

// ---------- naming ----------

describe("names take the lowest free number", () => {
  it("starts plain and numbers from 1", () => {
    expect(nextUntitledName([])).toBe(UNTITLED);
    expect(nextUntitledName([{ name: UNTITLED }])).toBe(`${UNTITLED} - 1`);
    expect(nextUntitledName([{ name: UNTITLED }, { name: `${UNTITLED} - 1` }])).toBe(
      `${UNTITLED} - 2`
    );
  });

  it("reuses a number freed by a delete", () => {
    const existing = [{ name: UNTITLED }, { name: `${UNTITLED} - 1` }, { name: `${UNTITLED} - 3` }];
    expect(nextUntitledName(existing)).toBe(`${UNTITLED} - 2`);
  });

  it("copies as '(copy)', then '(copy 2)'", () => {
    expect(copyName("Plan", [])).toBe("Plan (copy)");
    expect(copyName("Plan", [{ name: "Plan (copy)" }])).toBe("Plan (copy 2)");
    expect(copyName("Plan", [{ name: "Plan (copy)" }, { name: "Plan (copy 2)" }])).toBe(
      "Plan (copy 3)"
    );
  });

  it("compares on the trimmed name, as the input does", () => {
    expect(copyName("  Plan  ", [{ name: "Plan (copy)" }])).toBe("Plan (copy 2)");
  });
});

describe("which blueprint was open", () => {
  beforeEach(() => {
    stubLocalStorage();
  });

  it("round-trips an id", () => {
    writeOpenId(42);
    expect(readOpenId()).toBe(42);
  });

  it("forgets it on null", () => {
    writeOpenId(42);
    writeOpenId(null);
    expect(readOpenId()).toBeNull();
  });

  // "null", '""' and "[]" all coerce to 0, which is an integer — so before
  // this the fallback let them through as a row id no blueprint can have.
  // Found by this port.
  it.each([["{not json"], ['"seven"'], ["1.5"], ["null"], ['""'], ["[]"], ["true"]])(
    "falls back to 'most recent' on %s",
    (raw) => {
      stubLocalStorage().set(DESIGN_STORE, raw);
      expect(readOpenId()).toBeNull();
    }
  );
});
