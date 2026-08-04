import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type SparkList, type SparkListPatch, type SparkRef } from "./api";
import {
  ACTIVE_LISTS_STORE,
  activeSparks,
  createList,
  createListWith,
  deleteList,
  favorites,
  isFavorite,
  listById,
  listNames,
  listsWith,
  loadActiveLists,
  PartialWrite,
  renameList,
  saveActiveLists,
  setMembership,
  toggleActive,
  toggleMembership,
  union,
} from "./sparks";
import { restoreLocalStorage, stubBrokenLocalStorage, stubLocalStorage } from "./testing";

const spark = (kind: SparkRef["kind"], key: number): SparkRef => ({ kind, key });

const aList = (over: Partial<SparkList> & Pick<SparkList, "id">): SparkList => ({
  name: `list ${over.id}`,
  position: over.id,
  sparks: [],
  ...over,
});

// The module's four api calls, stubbed on the object itself — `api` is a plain
// record of functions, so there is nothing to intercept at module load and no
// mock framework needed. Each stub records what it was sent, which is the
// whole point of the write tests: the argument threading is the rule.
const stubApi = (over: {
  sparkLists?: () => Promise<SparkList[]>;
  createSparkList?: (name: string) => Promise<SparkList>;
  updateSparkList?: (id: number, body: SparkListPatch) => Promise<SparkList>;
  deleteSparkList?: (id: number) => Promise<void>;
}) => ({
  sparkLists: vi
    .spyOn(api, "sparkLists")
    .mockImplementation(over.sparkLists ?? (() => Promise.resolve([] as SparkList[]))),
  createSparkList: vi
    .spyOn(api, "createSparkList")
    .mockImplementation(
      over.createSparkList ?? ((name: string) => Promise.resolve(aList({ id: 99, name })))
    ),
  updateSparkList: vi
    .spyOn(api, "updateSparkList")
    .mockImplementation(
      over.updateSparkList ??
        ((id: number, body: SparkListPatch) => Promise.resolve(aList({ id, ...body })))
    ),
  deleteSparkList: vi
    .spyOn(api, "deleteSparkList")
    .mockImplementation(over.deleteSparkList ?? (() => Promise.resolve())),
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reads over the caller's lists", () => {
  const lists = [
    aList({ id: 1, name: "Front Runner", sparks: [spark("white", 700), spark("race", 700)] }),
    aList({ id: 2, name: "Medium", sparks: [spark("white", 700), spark("unique", 100_101)] }),
    aList({ id: 3, name: "Long", sparks: [] }),
  ];

  it("tells the kinds apart at the same key", () => {
    expect(isFavorite(lists, "white", 700)).toBe(true);
    expect(isFavorite(lists, "race", 700)).toBe(true);
    expect(isFavorite(lists, "scenario", 700)).toBe(false);
  });

  it("names every list holding a spark, so the picker can check its boxes", () => {
    expect(listsWith(lists, "white", 700).map((l) => l.name)).toEqual([
      "Front Runner",
      "Medium",
    ]);
    expect(listsWith(lists, "unique", 100_101).map((l) => l.name)).toEqual(["Medium"]);
    expect(listsWith(lists, "scenario", 1)).toEqual([]);
  });

  it("unions in list order then membership order, deduped", () => {
    // white 700 is in two builds and must render ONCE — the thing #33 got for
    // free with one row in two groups, and this shape solves at read time.
    expect(union(lists)).toEqual([
      spark("white", 700),
      spark("race", 700),
      spark("unique", 100_101),
    ]);
  });

  it("has favorites as the union — there is no watched-but-unlisted state", () => {
    expect(favorites(lists)).toEqual(union(lists));
  });

  it("finds a list by id, and says so when there isn't one", () => {
    expect(listById(lists, 2)?.name).toBe("Medium");
    expect(listById(lists, 87)).toBeUndefined();
  });

  it("names the lists in the user's order", () => {
    expect(listNames(lists)).toEqual(["Front Runner", "Medium", "Long"]);
  });
});

describe("the active selection", () => {
  const lists = [
    aList({ id: 1, sparks: [spark("white", 1)] }),
    aList({ id: 2, sparks: [spark("white", 2)] }),
    aList({ id: 3, sparks: [spark("white", 3)] }),
  ];

  it("unions only the chosen lists", () => {
    expect(activeSparks(lists, [1, 3])).toEqual([spark("white", 1), spark("white", 3)]);
  });

  it("shows EVERYTHING when nothing is selected, not nothing", () => {
    // Every user starts with no selection, and an empty block on first use
    // reads as broken rather than as unconfigured (DECISIONS.md #37).
    expect(activeSparks(lists, [])).toEqual([
      spark("white", 1),
      spark("white", 2),
      spark("white", 3),
    ]);
  });

  it("ignores an id that no longer names a list", () => {
    // Deleted on another device. Dropping it silently is the whole handling —
    // there is no reconcile pass.
    expect(activeSparks(lists, [2, 404])).toEqual([spark("white", 2)]);
  });

  it("falls back to everything when every selected id is stale", () => {
    // The lists went away, so this reads as "nothing selected" rather than as
    // an empty block the user cannot explain.
    expect(activeSparks(lists, [404, 405])).toEqual(union(lists));
  });

  it("toggles one id without disturbing the others", () => {
    expect(toggleActive([1, 2], 3)).toEqual([1, 2, 3]);
    expect(toggleActive([1, 2, 3], 2)).toEqual([1, 3]);
  });
});

describe("the active selection persists per device", () => {
  afterEach(restoreLocalStorage);

  it("round-trips through storage", () => {
    stubLocalStorage();
    saveActiveLists([3, 1]);
    expect(loadActiveLists()).toEqual([3, 1]);
  });

  it("reads an absent key as nothing selected", () => {
    stubLocalStorage();
    expect(loadActiveLists()).toEqual([]);
  });

  it("falls back rather than throwing when storage is blocked", () => {
    stubBrokenLocalStorage();
    expect(loadActiveLists()).toEqual([]);
    expect(() => saveActiveLists([1])).not.toThrow();
  });

  it.each([
    ["not JSON", "{{{"],
    ["not an array", '{"a":1}'],
    ["not numbers", '["1","2"]'],
    ["not integers", "[1.5]"],
  ])("falls back to everything on a corrupt key (%s)", (_why, raw) => {
    // Degrading to "everything" rather than to an empty block: a corrupt key
    // should show MORE than you asked for, never less.
    const store = stubLocalStorage();
    store.set(ACTIVE_LISTS_STORE, raw);
    expect(loadActiveLists()).toEqual([]);
  });
});

describe("writes", () => {
  it("creates a list and folds it into the caller's array", async () => {
    const calls = stubApi({});
    const next = await createList([aList({ id: 1 })], "Medium");
    expect(calls.createSparkList).toHaveBeenCalledWith("Medium");
    expect(next.map((l) => l.id)).toEqual([1, 99]);
  });

  it("renames without touching the membership it wasn't given", async () => {
    const calls = stubApi({
      updateSparkList: (id, body) =>
        Promise.resolve(aList({ id, name: body.name ?? "?", sparks: [spark("white", 1)] })),
    });
    const next = await renameList([aList({ id: 1, name: "Front" })], 1, "Front Runner");
    expect(calls.updateSparkList).toHaveBeenCalledWith(1, { name: "Front Runner" });
    expect(next[0]?.name).toBe("Front Runner");
    expect(next[0]?.sparks).toEqual([spark("white", 1)]);
  });

  it("deletes the list and everything in it, leaving nothing to sweep", async () => {
    const calls = stubApi({});
    const lists = [
      aList({ id: 1, sparks: [spark("white", 1)] }),
      aList({ id: 2, sparks: [spark("white", 2)] }),
    ];
    expect(await deleteList(lists, 1)).toEqual([lists[1]]);
    expect(calls.deleteSparkList).toHaveBeenCalledWith(1);
  });

  it("sets membership wholesale", async () => {
    const calls = stubApi({});
    await setMembership([aList({ id: 1 })], 1, [spark("race", 40)]);
    expect(calls.updateSparkList).toHaveBeenCalledWith(1, { sparks: [spark("race", 40)] });
  });

  it("re-sorts by position after a write, matching what the next GET returns", async () => {
    const calls = stubApi({
      updateSparkList: (id, body) => Promise.resolve(aList({ id, position: 0, ...body })),
    });
    const lists = [aList({ id: 1, position: 0 }), aList({ id: 2, position: 1 })];
    const next = await setMembership(lists, 2, []);
    expect(calls.updateSparkList).toHaveBeenCalledTimes(1);
    // Both at position 0 now, so the tie breaks on id — a total order, so a
    // list cannot swap places between reads.
    expect(next.map((l) => l.id)).toEqual([1, 2]);
  });
});

describe("toggling one list's membership", () => {
  it("adds the spark when the list doesn't hold it", async () => {
    const calls = stubApi({});
    await toggleMembership([aList({ id: 1, sparks: [spark("white", 1)] })], 1, "race", 40);
    expect(calls.updateSparkList).toHaveBeenCalledWith(1, {
      sparks: [spark("white", 1), spark("race", 40)],
    });
  });

  it("removes it when the list does", async () => {
    const calls = stubApi({});
    const lists = [aList({ id: 1, sparks: [spark("white", 1), spark("race", 40)] })];
    await toggleMembership(lists, 1, "race", 40);
    expect(calls.updateSparkList).toHaveBeenCalledWith(1, { sparks: [spark("white", 1)] });
  });

  it("tells the kinds apart at the same key", async () => {
    const calls = stubApi({});
    const lists = [aList({ id: 1, sparks: [spark("white", 700)] })];
    await toggleMembership(lists, 1, "race", 700);
    expect(calls.updateSparkList).toHaveBeenCalledWith(1, {
      sparks: [spark("white", 700), spark("race", 700)],
    });
  });

  it("is a NO-OP for a list the caller doesn't have, never a create", async () => {
    // The id came from a control rendered off these same lists, so its absence
    // means the list was deleted — re-creating it would resurrect what another
    // device just removed.
    const calls = stubApi({});
    const lists = [aList({ id: 1 })];
    expect(await toggleMembership(lists, 87, "white", 1)).toBe(lists);
    expect(calls.updateSparkList).not.toHaveBeenCalled();
    expect(calls.createSparkList).not.toHaveBeenCalled();
  });
});

describe("creating a list around a spark", () => {
  it("creates it, then puts the spark in it", async () => {
    const calls = stubApi({});
    const next = await createListWith([], "Front Runner", "white", 700);
    expect(calls.createSparkList).toHaveBeenCalledWith("Front Runner");
    expect(calls.updateSparkList).toHaveBeenCalledWith(99, {
      sparks: [spark("white", 700)],
    });
    expect(next.map((l) => l.id)).toEqual([99]);
  });

  it("propagates a rejected create and never writes membership", async () => {
    // A 409 for a name already in use. The picker keeps the typed name so the
    // user can correct it, which only works if this rejects rather than
    // swallowing.
    const calls = stubApi({
      createSparkList: () => Promise.reject(new Error("409")),
    });
    await expect(createListWith([], "Front Runner", "white", 700)).rejects.toThrow();
    expect(calls.updateSparkList).not.toHaveBeenCalled();
  });

  it("hands back the created list when only the membership write fails", async () => {
    // The defect this replaced: letting the whole promise reject discarded a
    // row the server had COMMITTED. The list showed up nowhere, so there was
    // no pill to retry on, and re-typing the same name 409'd forever against
    // a list the user could not see.
    stubApi({ updateSparkList: () => Promise.reject(new Error("boom")) });
    const error = await createListWith([], "Front Runner", "white", 700).catch(
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(PartialWrite);
    const partial = error as PartialWrite;
    // The list exists and is empty — exactly what the server holds.
    expect(partial.lists.map((l) => l.name)).toEqual(["Front Runner"]);
    expect(partial.lists[0]?.sparks).toEqual([]);
  });

  it("keeps the caller's other lists in the partial result", async () => {
    stubApi({ updateSparkList: () => Promise.reject(new Error("boom")) });
    const existing = [aList({ id: 1, name: "Medium", sparks: [spark("white", 1)] })];
    const error = (await createListWith(existing, "Front Runner", "white", 700).catch(
      (e: unknown) => e
    )) as PartialWrite;
    expect(error.lists.map((l) => l.name)).toEqual(["Medium", "Front Runner"]);
    expect(error.lists[0]?.sparks).toEqual([spark("white", 1)]);
  });

  it("throws a plain error, not a PartialWrite, when the create itself fails", async () => {
    // Nothing was committed, so there is nothing for the caller to adopt —
    // and adopting an empty array here would wipe the lists it already had.
    stubApi({ createSparkList: () => Promise.reject(new Error("409")) });
    const error = await createListWith(
      [aList({ id: 1 })],
      "Front Runner",
      "white",
      700
    ).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(PartialWrite);
  });
});
