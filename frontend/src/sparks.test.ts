import { afterEach, describe, expect, it, vi } from "vitest";
import {
  api,
  ApiError,
  type ListSparkKind,
  type SparkList,
  type SparkListPatch,
  type SparkRef,
} from "./api";
import {
  ACTIVE_LISTS_STORE,
  activeSparkIds,
  activeSparks,
  chosenLists,
  createList,
  createListWith,
  deleteList,
  favorites,
  isFavorite,
  LIST_SORT_STORE,
  listById,
  ListGone,
  listsWith,
  loadActiveLists,
  loadListSort,
  renameList,
  saveActiveLists,
  saveListSort,
  sortLists,
  syncMembership,
  toggleActive,
  toggleListSpark,
  union,
  withMembership,
  withStamp,
} from "./sparks";
import { restoreLocalStorage, stubBrokenLocalStorage, stubLocalStorage } from "./testing";

const spark = (kind: SparkRef["kind"], key: number): SparkRef => ({ kind, key });

const aList = (over: Partial<SparkList> & Pick<SparkList, "id">): SparkList => ({
  name: `list ${over.id}`,
  updated_at: "2026-08-10T00:00:00Z",
  sparks: [],
  ...over,
});

// The module's api calls, stubbed on the object itself — `api` is a plain
// record of functions, so there is nothing to intercept at module load and no
// mock framework needed. Each stub records what it was sent, which is the
// whole point of the write tests: the argument threading is the rule.
const stubApi = (over: {
  sparkLists?: () => Promise<SparkList[]>;
  createSparkList?: (name: string, sparks?: SparkRef[]) => Promise<SparkList>;
  updateSparkList?: (id: number, body: SparkListPatch) => Promise<SparkList>;
  addListSpark?: (id: number, kind: ListSparkKind, key: number) => Promise<SparkList>;
  removeListSpark?: (id: number, kind: ListSparkKind, key: number) => Promise<SparkList>;
  deleteSparkList?: (id: number) => Promise<void>;
}) => ({
  sparkLists: vi
    .spyOn(api, "sparkLists")
    .mockImplementation(over.sparkLists ?? (() => Promise.resolve([] as SparkList[]))),
  createSparkList: vi
    .spyOn(api, "createSparkList")
    .mockImplementation(
      over.createSparkList ??
        ((name: string, sparks: SparkRef[] = []) =>
          Promise.resolve(aList({ id: 99, name, sparks })))
    ),
  updateSparkList: vi
    .spyOn(api, "updateSparkList")
    .mockImplementation(
      over.updateSparkList ??
        ((id: number, body: SparkListPatch) => Promise.resolve(aList({ id, ...body })))
    ),
  addListSpark: vi
    .spyOn(api, "addListSpark")
    .mockImplementation(
      over.addListSpark ??
        ((id: number, kind: ListSparkKind, key: number) =>
          Promise.resolve(aList({ id, sparks: [{ kind, key }] })))
    ),
  removeListSpark: vi
    .spyOn(api, "removeListSpark")
    .mockImplementation(
      over.removeListSpark ??
        ((id: number) => Promise.resolve(aList({ id })))
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
    aList({ id: 2, name: "Medium", sparks: [spark("white", 700), spark("scenario", 40_001)] }),
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
    expect(listsWith(lists, "scenario", 40_001).map((l) => l.name)).toEqual(["Medium"]);
    expect(listsWith(lists, "scenario", 1)).toEqual([]);
  });

  it("unions in list order then membership order, deduped", () => {
    // white 700 is in two builds and must render ONCE — the thing #33 got for
    // free with one row in two groups, and this shape solves at read time.
    expect(union(lists)).toEqual([
      spark("white", 700),
      spark("race", 700),
      spark("scenario", 40_001),
    ]);
  });

  it("has favorites as the union — there is no watched-but-unlisted state", () => {
    expect(favorites(lists)).toEqual(union(lists));
  });

  it("finds a list by id, and says so when there isn't one", () => {
    expect(listById(lists, 2)?.name).toBe("Medium");
    expect(listById(lists, 87)).toBeUndefined();
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

describe("the selection as a filter", () => {
  const lists = [
    aList({ id: 1, sparks: [spark("white", 1)] }),
    aList({ id: 2, sparks: [spark("race", 2)] }),
    aList({ id: 3, sparks: [spark("scenario", 3)] }),
  ];

  it("names no list when nothing is selected — NOT everything", () => {
    // The distinction from `activeSparks`: a filter with nothing selected is
    // no filter, and the caller renders the whole unfiltered view.
    expect(chosenLists(lists, [])).toEqual([]);
  });

  it("drops stale ids, to nothing if that's all there was", () => {
    expect(chosenLists(lists, [2, 404]).map((l) => l.id)).toEqual([2]);
    expect(chosenLists(lists, [404, 405])).toEqual([]);
  });

  it("keeps list order regardless of selection order", () => {
    expect(chosenLists(lists, [3, 1]).map((l) => l.id)).toEqual([1, 3]);
  });
});

describe("the selection as row ids", () => {
  const lists = [
    aList({ id: 1, sparks: [spark("white", 700), spark("race", 40)] }),
    aList({ id: 2, sparks: [spark("scenario", 40_001)] }),
  ];

  it("tests membership by kind and key", () => {
    const ids = activeSparkIds(lists, [1]);
    expect(ids.has("white:700")).toBe(true);
    expect(ids.has("race:40")).toBe(true);
    expect(ids.has("scenario:40001")).toBe(false);
  });

  it("keeps activeSparks' empty-means-everything rule", () => {
    expect(activeSparkIds(lists, []).size).toBe(3);
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
  it("creates a list and resolves to a fold that adds it", async () => {
    const calls = stubApi({});
    const fold = await createList("Medium");
    expect(calls.createSparkList).toHaveBeenCalledWith("Medium");
    expect(fold([aList({ id: 1 })]).map((l) => l.id)).toEqual([1, 99]);
  });

  it("renames by folding the name and stamp, never the membership", async () => {
    // The server's response carries membership as of the rename, and a
    // toggle can be in flight on the same list — the flip is the record
    // (DECISIONS.md #49), so the fold must not adopt the response's sparks.
    const calls = stubApi({
      updateSparkList: (id, body) =>
        Promise.resolve(
          aList({
            id,
            name: body.name ?? "?",
            sparks: [spark("white", 9)],
            updated_at: "2026-08-12T00:00:00Z",
          })
        ),
    });
    const fold = await renameList(1, "Front Runner");
    expect(calls.updateSparkList).toHaveBeenCalledWith(1, { name: "Front Runner" });
    const next = fold([aList({ id: 1, name: "Front", sparks: [spark("white", 1)] })]);
    expect(next[0]?.name).toBe("Front Runner");
    expect(next[0]?.sparks).toEqual([spark("white", 1)]);
    expect(next[0]?.updated_at).toBe("2026-08-12T00:00:00Z");
  });

  it("deletes the list and everything in it, leaving nothing to sweep", async () => {
    const calls = stubApi({});
    const lists = [
      aList({ id: 1, sparks: [spark("white", 1)] }),
      aList({ id: 2, sparks: [spark("white", 2)] }),
    ];
    const fold = await deleteList(1);
    expect(fold(lists)).toEqual([lists[1]]);
    expect(calls.deleteSparkList).toHaveBeenCalledWith(1);
  });

  it("keeps creation order after a write, matching what the next GET returns", async () => {
    stubApi({});
    // Handed in reversed: the fold must re-sort to the server's id order, so
    // a write can never make a list swap places between reads.
    const fold = await createList("Medium");
    expect(fold([aList({ id: 2 }), aList({ id: 1 })]).map((l) => l.id)).toEqual([
      1, 2, 99,
    ]);
  });

  it("cannot clobber a flip that lands during the round trip", async () => {
    // Resolving to an ARRAY adopted a pre-await snapshot, and adopting it
    // overwrote any optimistic flip that landed while the write flew. The
    // fold applies to whatever state holds when the write resolves, which
    // is the caller's adoption pattern verbatim.
    stubApi({});
    let state: SparkList[] = [aList({ id: 1 })];
    const onChange = (u: SparkList[] | ((prev: SparkList[]) => SparkList[])) => {
      state = typeof u === "function" ? u(state) : u;
    };
    const pending = createList("New");
    onChange((prev) => withMembership(prev, 1, "white", 700, true));
    onChange(await pending);
    expect(state.find((l) => l.id === 1)?.sparks).toEqual([spark("white", 700)]);
    expect(state.map((l) => l.id)).toEqual([1, 99]);
  });
});

describe("flipping one membership locally", () => {
  it("adds at the end — where the server's member-id order puts a fresh row", () => {
    const lists = [aList({ id: 1, sparks: [spark("white", 1)] })];
    const next = withMembership(lists, 1, "race", 40, true);
    expect(next[0]?.sparks).toEqual([spark("white", 1), spark("race", 40)]);
  });

  it("removes only the named membership", () => {
    const lists = [aList({ id: 1, sparks: [spark("white", 1), spark("race", 40)] })];
    const next = withMembership(lists, 1, "race", 40, false);
    expect(next[0]?.sparks).toEqual([spark("white", 1)]);
  });

  it("tells the kinds apart at the same key", () => {
    const lists = [aList({ id: 1, sparks: [spark("white", 700)] })];
    const next = withMembership(lists, 1, "race", 700, false);
    expect(next[0]?.sparks).toEqual([spark("white", 700)]);
  });

  it("states an end state, so re-applying it cannot double a spark", () => {
    // The revert is this same function with `present` inverted, and under
    // chained writes it can land on a list already in the state it names.
    const lists = [aList({ id: 1, sparks: [spark("race", 40)] })];
    expect(withMembership(lists, 1, "race", 40, true)[0]).toBe(lists[0]);
    expect(withMembership(lists, 1, "race", 40, false)[0]?.sparks).toEqual([]);
  });

  it("is a NO-OP for a list the caller doesn't have, never a create", () => {
    // The id came from a control rendered off these same lists, so its absence
    // means the list was deleted — re-creating it would resurrect what another
    // device just removed.
    const lists = [aList({ id: 1 })];
    expect(withMembership(lists, 87, "white", 1, true)).toEqual(lists);
  });

  it("leaves other lists' rows untouched, not just unchanged", () => {
    // Referential stability is what keeps an unrelated row from re-rendering
    // under the pointer mid-flip.
    const lists = [aList({ id: 1 }), aList({ id: 2 })];
    const next = withMembership(lists, 1, "white", 1, true);
    expect(next[1]).toBe(lists[1]);
  });
});

describe("folding a settled write's stamp", () => {
  it("takes the later stamp, whichever side holds it", () => {
    // Max, not last-write: responses can land out of order, and the fold must
    // be immune to an older one arriving late.
    const lists = [aList({ id: 1, updated_at: "2026-08-10T00:00:00Z" })];
    expect(withStamp(lists, 1, "2026-08-11T00:00:00Z")[0]?.updated_at).toBe(
      "2026-08-11T00:00:00Z"
    );
    expect(withStamp(lists, 1, "2026-08-09T00:00:00Z")[0]).toBe(lists[0]);
  });

  it("never touches membership — the flip is the record", () => {
    const lists = [aList({ id: 1, sparks: [spark("white", 1)] })];
    const next = withStamp(lists, 1, "2026-08-11T00:00:00Z");
    expect(next[0]?.sparks).toEqual([spark("white", 1)]);
  });
});

describe("the request behind a flip", () => {
  it("PUTs when the flip added and DELETEs when it removed", async () => {
    const calls = stubApi({});
    await syncMembership(1, "race", 40, true);
    expect(calls.addListSpark).toHaveBeenCalledWith(1, "race", 40);
    expect(calls.removeListSpark).not.toHaveBeenCalled();
    await syncMembership(1, "race", 40, false);
    expect(calls.removeListSpark).toHaveBeenCalledWith(1, "race", 40);
  });

  it("chains writes to the SAME membership behind each other", async () => {
    // The verbs are absolute, so ordering is the whole correctness story: a
    // double-click's PUT then DELETE arriving swapped would leave the server
    // holding what the screen shows removed.
    const resolvers: Array<(value: SparkList) => void> = [];
    const calls = stubApi({
      addListSpark: () => new Promise((resolve) => resolvers.push(resolve)),
      removeListSpark: () => new Promise((resolve) => resolvers.push(resolve)),
    });
    const first = syncMembership(1, "white", 700, true);
    const second = syncMembership(1, "white", 700, false);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.addListSpark).toHaveBeenCalledTimes(1);
    expect(calls.removeListSpark).not.toHaveBeenCalled();
    resolvers[0]?.(aList({ id: 1 }));
    await first;
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.removeListSpark).toHaveBeenCalledTimes(1);
    resolvers[1]?.(aList({ id: 1 }));
    await second;
  });

  it("keeps chaining past a failed predecessor — a failure must not wedge the pill", async () => {
    const calls = stubApi({
      addListSpark: () => Promise.reject(new ApiError(500, "boom")),
    });
    await expect(syncMembership(1, "white", 700, true)).rejects.toThrow();
    await syncMembership(1, "white", 700, false);
    expect(calls.removeListSpark).toHaveBeenCalledTimes(1);
  });

  it("resolves null, not a rejection, when a newer write supersedes the failure", async () => {
    // A double-click's first write failing while its second succeeds ends
    // the server exactly where the screen shows, so the first write's
    // failure must decide nothing — no revert, no "Couldn't save".
    let rejectAdd: (reason: unknown) => void = () => {};
    const calls = stubApi({
      addListSpark: () => new Promise((_, reject) => { rejectAdd = reject; }),
    });
    const first = syncMembership(1, "white", 700, true);
    const second = syncMembership(1, "white", 700, false);
    // The PUT issues on a microtask; `rejectAdd` is a no-op until it has.
    await new Promise((r) => setTimeout(r, 0));
    rejectAdd(new ApiError(500, "boom"));
    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toEqual(aList({ id: 1 }));
    expect(calls.removeListSpark).toHaveBeenCalledTimes(1);
  });

  it("lets different pills fly in parallel", async () => {
    const resolvers: Array<(value: SparkList) => void> = [];
    const calls = stubApi({
      addListSpark: () => new Promise((resolve) => resolvers.push(resolve)),
    });
    const one = syncMembership(1, "white", 700, true);
    const two = syncMembership(2, "white", 700, true);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.addListSpark).toHaveBeenCalledTimes(2);
    resolvers.forEach((resolve) => resolve(aList({ id: 1 })));
    await Promise.all([one, two]);
  });

  it("throws ListGone on a 404", async () => {
    // Deleted on the server since this copy was read. The caller drops the
    // dead row from CURRENT state so the pill disappears in place — no
    // reload, no remount (issue #66's absorbed #73).
    stubApi({
      addListSpark: () => Promise.reject(new ApiError(404, "no such list")),
    });
    const error = await syncMembership(2, "race", 40, true).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ListGone);
  });

  it("passes any other failure through untouched", async () => {
    // Only "the list is gone" earns the corrective drop — a 500 or a network
    // blip must not delete a list from the screen that still exists.
    stubApi({
      removeListSpark: () => Promise.reject(new ApiError(500, "boom")),
    });
    const error = await syncMembership(1, "race", 40, false).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).not.toBeInstanceOf(ListGone);
  });
});

describe("the shared optimistic toggle", () => {
  // Both surfaces hand `toggleListSpark` a setState-shaped onChange; this
  // harness is that contract with the state held locally.
  const harness = (initial: SparkList[]) => {
    let state = initial;
    const errors: string[] = [];
    return {
      get state() {
        return state;
      },
      errors,
      onChange: (next: SparkList[] | ((prev: SparkList[]) => SparkList[])) => {
        state = typeof next === "function" ? next(state) : next;
      },
      onError: (message: string) => {
        errors.push(message);
      },
    };
  };

  it("flips before the request settles, then folds only the stamp", async () => {
    let resolveAdd: (value: SparkList) => void = () => {};
    stubApi({
      addListSpark: () => new Promise((resolve) => (resolveAdd = resolve)),
    });
    const h = harness([aList({ id: 11 })]);
    toggleListSpark(h.state, 11, "white", 700, h.onChange, h.onError);
    expect(h.state[0]?.sparks).toEqual([spark("white", 700)]);
    // The PUT issues on a microtask; `resolveAdd` is a no-op until it has.
    await new Promise((r) => setTimeout(r, 0));
    resolveAdd(
      aList({ id: 11, name: "renamed elsewhere", updated_at: "2026-08-11T00:00:00Z" })
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(h.state[0]?.sparks).toEqual([spark("white", 700)]);
    expect(h.state[0]?.updated_at).toBe("2026-08-11T00:00:00Z");
    expect(h.state[0]?.name).toBe("list 11");
    expect(h.errors).toEqual([]);
  });

  it("re-states the opposite membership and toasts on a final failure", async () => {
    stubApi({
      addListSpark: () => Promise.reject(new ApiError(500, "boom")),
    });
    const h = harness([aList({ id: 12 })]);
    toggleListSpark(h.state, 12, "white", 700, h.onChange, h.onError);
    expect(h.state[0]?.sparks).toEqual([spark("white", 700)]);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.state[0]?.sparks).toEqual([]);
    expect(h.errors).toEqual(["Couldn't save that list change — try again."]);
  });

  it("stays quiet when a newer toggle supersedes the failure", async () => {
    let rejectAdd: (reason: unknown) => void = () => {};
    stubApi({
      addListSpark: () => new Promise((_, reject) => (rejectAdd = reject)),
    });
    const h = harness([aList({ id: 13 })]);
    toggleListSpark(h.state, 13, "white", 700, h.onChange, h.onError);
    toggleListSpark(h.state, 13, "white", 700, h.onChange, h.onError);
    await new Promise((r) => setTimeout(r, 0));
    rejectAdd(new ApiError(500, "boom"));
    await new Promise((r) => setTimeout(r, 0));
    expect(h.state[0]?.sparks).toEqual([]);
    expect(h.errors).toEqual([]);
  });

  it("drops the dead row in place on ListGone", async () => {
    stubApi({
      addListSpark: () => Promise.reject(new ApiError(404, "no such list")),
    });
    const h = harness([aList({ id: 14 }), aList({ id: 15 })]);
    toggleListSpark(h.state, 14, "white", 700, h.onChange, h.onError);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.state.map((l) => l.id)).toEqual([15]);
    expect(h.errors).toEqual(["That list was deleted somewhere else."]);
  });

  it("is a no-op for a list the caller no longer holds", () => {
    const calls = stubApi({});
    const h = harness([aList({ id: 16 })]);
    toggleListSpark(h.state, 999, "white", 700, h.onChange, h.onError);
    expect(h.state).toEqual([aList({ id: 16 })]);
    expect(calls.addListSpark).not.toHaveBeenCalled();
    expect(calls.removeListSpark).not.toHaveBeenCalled();
  });
});

describe("the management page's sort", () => {
  const lists = [
    aList({ id: 1, name: "Medium", updated_at: "2026-08-09T00:00:00Z" }),
    aList({ id: 2, name: "front runner", updated_at: "2026-08-10T12:00:00Z" }),
    aList({ id: 3, name: "Long", updated_at: "2026-08-08T00:00:00Z" }),
  ];

  it("sorts by name case-insensitively, by creation newest-first, and by edit time", () => {
    expect(sortLists(lists, "name").map((l) => l.id)).toEqual([2, 3, 1]);
    expect(sortLists(lists, "newest").map((l) => l.id)).toEqual([3, 2, 1]);
    expect(sortLists(lists, "edited").map((l) => l.id)).toEqual([2, 1, 3]);
  });

  it("breaks every tie on id, so equal keys cannot swap between renders", () => {
    const tied = [
      aList({ id: 2, name: "Same" }),
      aList({ id: 1, name: "Same" }),
    ];
    expect(sortLists(tied, "name").map((l) => l.id)).toEqual([1, 2]);
    expect(sortLists(tied, "edited").map((l) => l.id)).toEqual([2, 1]);
  });

  it("does not disturb the caller's array", () => {
    const before = lists.map((l) => l.id);
    sortLists(lists, "name");
    expect(lists.map((l) => l.id)).toEqual(before);
  });
});

describe("the sort persists per device", () => {
  afterEach(restoreLocalStorage);

  it("round-trips through storage", () => {
    stubLocalStorage();
    saveListSort("edited");
    expect(loadListSort()).toBe("edited");
  });

  it.each([
    ["absent", null],
    ["not a mode", '"position"'],
  ])("falls back to name order (%s)", (_why, raw) => {
    const store = stubLocalStorage();
    if (raw !== null) store.set(LIST_SORT_STORE, raw);
    expect(loadListSort()).toBe("name");
  });

  it("falls back rather than throwing when storage is blocked", () => {
    stubBrokenLocalStorage();
    expect(loadListSort()).toBe("name");
    expect(() => saveListSort("newest")).not.toThrow();
  });
});

describe("creating a list around a spark", () => {
  it("is ONE request, carrying the spark in the create", async () => {
    // The two-request shape needed PartialWrite for its half-committed
    // failure; one transaction retired both (issue #69, DECISIONS.md #49).
    const calls = stubApi({});
    const fold = await createListWith("Front Runner", "white", 700);
    expect(calls.createSparkList).toHaveBeenCalledWith("Front Runner", [
      spark("white", 700),
    ]);
    expect(calls.addListSpark).not.toHaveBeenCalled();
    const next = fold([]);
    expect(next.map((l) => l.id)).toEqual([99]);
    expect(next[0]?.sparks).toEqual([spark("white", 700)]);
  });

  it("folds the created list among the caller's, in id order", async () => {
    stubApi({});
    const fold = await createListWith("Front Runner", "white", 700);
    const next = fold([aList({ id: 1, name: "Medium", sparks: [spark("white", 1)] })]);
    expect(next.map((l) => l.name)).toEqual(["Medium", "Front Runner"]);
    expect(next[0]?.sparks).toEqual([spark("white", 1)]);
  });

  it("propagates a rejected create untouched — nothing landed, nothing to adopt", async () => {
    // A 409 for a name already in use. The picker keeps the typed name so the
    // user can correct it, which only works if this rejects rather than
    // swallowing.
    stubApi({ createSparkList: () => Promise.reject(new ApiError(409, "409")) });
    await expect(createListWith("Front Runner", "white", 700)).rejects.toThrow();
  });
});
