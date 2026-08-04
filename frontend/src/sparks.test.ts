import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type SlotFactorKind, type WatchedSpark, type WatchedSparkPatch } from "./api";
import {
  groupNames,
  groupsOf,
  isHunting,
  isWatched,
  list,
  setGroups,
  setHunting,
  toggle,
} from "./sparks";

const watched = (over: Partial<WatchedSpark> & Pick<WatchedSpark, "id">): WatchedSpark => ({
  kind: "white",
  key: over.id,
  hunting: true,
  groups: [],
  ...over,
});

// The module's three api calls, stubbed on the object itself — `api` is a
// plain record of functions, so there is nothing to intercept at module load
// and no mock framework needed. Each stub records what it was sent, which is
// the whole point of the write tests: the argument threading is the rule.
const stubApi = (over: {
  watchedSparks?: () => Promise<WatchedSpark[]>;
  watchSpark?: (k: SlotFactorKind, key: number, body: WatchedSparkPatch) => Promise<WatchedSpark>;
  unwatchSpark?: (k: SlotFactorKind, key: number) => Promise<void>;
}) => {
  const calls = {
    watchedSparks: vi
      .spyOn(api, "watchedSparks")
      .mockImplementation(over.watchedSparks ?? (() => Promise.resolve([] as WatchedSpark[]))),
    watchSpark: vi.spyOn(api, "watchSpark").mockImplementation(
      over.watchSpark ??
        ((kind: SlotFactorKind, key: number, body: WatchedSparkPatch) =>
          Promise.resolve(watched({ id: key, kind, key, ...body })))
    ),
    unwatchSpark: vi
      .spyOn(api, "unwatchSpark")
      .mockImplementation(over.unwatchSpark ?? (() => Promise.resolve())),
  };
  return calls;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reads over the caller's list", () => {
  const rows = [
    watched({ id: 1, kind: "white", key: 700, hunting: true, groups: ["Front"] }),
    watched({ id: 2, kind: "race", key: 700, hunting: false, groups: ["Front", "Mile"] }),
    watched({ id: 3, kind: "unique", key: 100_101, hunting: true, groups: [] }),
  ];

  it("tells the kinds apart at the same key", () => {
    expect(isWatched(rows, "white", 700)).toBe(true);
    expect(isWatched(rows, "race", 700)).toBe(true);
    expect(isWatched(rows, "scenario", 700)).toBe(false);
  });

  it("reads an unwatched spark as not hunted, so a caller asks one question", () => {
    expect(isHunting(rows, "white", 700)).toBe(true);
    expect(isHunting(rows, "race", 700)).toBe(false);
    expect(isHunting(rows, "scenario", 700)).toBe(false);
  });

  it("has no groups for a spark that isn't on the list", () => {
    expect(groupsOf(rows, "race", 700)).toEqual(["Front", "Mile"]);
    expect(groupsOf(rows, "scenario", 1)).toEqual([]);
  });

  it("lists everything, or one group's worth", () => {
    expect(list(rows)).toBe(rows);
    expect(list(rows, "Front").map((s) => s.id)).toEqual([1, 2]);
    expect(list(rows, "Mile").map((s) => s.id)).toEqual([2]);
    expect(list(rows, "Nothing")).toEqual([]);
  });

  it("names each group once, in the order it was first written", () => {
    expect(groupNames(rows)).toEqual(["Front", "Mile"]);
    expect(groupNames([])).toEqual([]);
  });
});


// ---------- writes ----------
// Every one of these asserts that NOTHING re-reads the list. That is the
// point of #64: a mutator sends the field it is changing and nothing else, so
// it never has to know — or fetch — the field it isn't touching.

describe("toggle", () => {
  it("adds with an empty body, letting the server furnish a new row", async () => {
    const calls = stubApi({});
    const next = await toggle([], "white", 700);
    expect(calls.watchSpark).toHaveBeenCalledWith("white", 700, {});
    expect(calls.watchedSparks).not.toHaveBeenCalled();
    expect(next.map((s) => s.key)).toEqual([700]);
  });

  // Issue #62, and the reason #64 closed it at the route rather than in the
  // client: the empty body cannot overwrite anything, so a row watched on
  // another device comes back untouched instead of being replaced with
  // defaults. There is no window to race, either — the old fix re-read first
  // and could still be beaten between the read and the write.
  it("cannot clobber a row that is only missing from this copy of the list", async () => {
    const server = watched({
      id: 9,
      kind: "white",
      key: 700,
      hunting: false,
      groups: ["Mile", "Front"],
    });
    const calls = stubApi({ watchSpark: () => Promise.resolve(server) });
    const next = await toggle([], "white", 700);
    expect(calls.watchSpark).toHaveBeenCalledWith("white", 700, {});
    // The star lands on, and the row keeps the filler bit and the groups.
    expect(next).toEqual([server]);
  });

  it("removes a watched one, and only that one", async () => {
    const calls = stubApi({});
    const rows = [watched({ id: 1, kind: "white", key: 700 }), watched({ id: 2, key: 800 })];
    const next = await toggle(rows, "white", 700);
    expect(calls.unwatchSpark).toHaveBeenCalledWith("white", 700);
    expect(calls.watchSpark).not.toHaveBeenCalled();
    // The DELETE route treats an already-gone row as success, so a stale
    // "watched" costs one 204 and needs no lookup.
    expect(calls.watchedSparks).not.toHaveBeenCalled();
    expect(next.map((s) => s.key)).toEqual([800]);
  });

  it("does not mutate the list it was handed", async () => {
    stubApi({});
    const rows = [watched({ id: 1, kind: "white", key: 700 })];
    await toggle(rows, "white", 700);
    expect(rows).toHaveLength(1);
  });
});

describe("setHunting", () => {
  it("sends the bit and nothing else, so the groups are never named", async () => {
    const calls = stubApi({});
    const rows = [watched({ id: 1, kind: "white", key: 700, hunting: true, groups: ["Front"] })];
    await setHunting(rows, "white", 700, false);
    expect(calls.watchSpark).toHaveBeenCalledWith("white", 700, { hunting: false });
    expect(calls.watchedSparks).not.toHaveBeenCalled();
  });

  it("adds a spark that isn't watched yet — the route is an upsert", async () => {
    const calls = stubApi({});
    const next = await setHunting([], "unique", 100_101, true);
    expect(calls.watchSpark).toHaveBeenCalledWith("unique", 100_101, { hunting: true });
    expect(next).toHaveLength(1);
  });

  // What #62 was: a row can exist server-side and be missing from this copy
  // of the list, and a mutator that named the field it wasn't changing would
  // rewrite the user's own choice. Now it cannot name it.
  it("leaves the groups of a row it has never seen alone", async () => {
    const server = watched({ id: 9, kind: "white", key: 700, groups: ["Mile"] });
    const calls = stubApi({ watchSpark: () => Promise.resolve(server) });
    const next = await setHunting([], "white", 700, false);
    expect(calls.watchSpark).toHaveBeenCalledWith("white", 700, { hunting: false });
    expect(next[0].groups).toEqual(["Mile"]);
  });
});

describe("setGroups", () => {
  it("sends the groups and nothing else, so the bit is never named", async () => {
    const calls = stubApi({});
    const rows = [watched({ id: 1, kind: "white", key: 700, hunting: false, groups: [] })];
    await setGroups(rows, "white", 700, ["Front"]);
    expect(calls.watchSpark).toHaveBeenCalledWith("white", 700, { groups: ["Front"] });
    expect(calls.watchedSparks).not.toHaveBeenCalled();
  });

  // The case that used to need a re-read: guessing the bit here would
  // re-hunt a spark deliberately marked as filler on another tab.
  it("does not re-hunt filler it has never seen", async () => {
    const server = watched({ id: 9, kind: "white", key: 700, hunting: false, groups: ["Front"] });
    const calls = stubApi({ watchSpark: () => Promise.resolve(server) });
    const next = await setGroups([], "white", 700, ["Front"]);
    expect(calls.watchSpark).toHaveBeenCalledWith("white", 700, { groups: ["Front"] });
    expect(next[0].hunting).toBe(false);
  });

  it("clears them with an empty list, which is a different request from omitting", async () => {
    const calls = stubApi({});
    await setGroups([], "white", 700, []);
    expect(calls.watchSpark).toHaveBeenCalledWith("white", 700, { groups: [] });
  });
});

describe("the returned list", () => {
  it("replaces a row in place rather than moving it", async () => {
    stubApi({
      watchSpark: (kind, key, body) => Promise.resolve(watched({ id: 2, kind, key, ...body })),
    });
    const rows = [
      watched({ id: 1, kind: "white", key: 700 }),
      watched({ id: 2, kind: "race", key: 4 }),
      watched({ id: 3, kind: "white", key: 900 }),
    ];
    const next = await setHunting(rows, "race", 4, false);
    expect(next.map((s) => s.id)).toEqual([1, 2, 3]);
    expect(next[1].hunting).toBe(false);
  });

  // id IS the insertion order the server sorts by, so a row this copy of the
  // list predates belongs where its id puts it, not at the end.
  it("inserts a row the local list predates by id, not by appending", async () => {
    stubApi({
      watchSpark: (kind, key, body) => Promise.resolve(watched({ id: 3, kind, key, ...body })),
    });
    const rows = [watched({ id: 1 }), watched({ id: 5 })];
    expect((await setHunting(rows, "white", 3, true)).map((s) => s.id)).toEqual([1, 3, 5]);
  });

  it("appends when the new row is the newest", async () => {
    stubApi({
      watchSpark: (kind, key, body) => Promise.resolve(watched({ id: 7, kind, key, ...body })),
    });
    const rows = [watched({ id: 1 }), watched({ id: 2 })];
    expect((await setHunting(rows, "white", 7, true)).map((s) => s.id)).toEqual([1, 2, 7]);
  });
});
