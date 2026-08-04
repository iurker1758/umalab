import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type SlotFactorKind, type WatchedSpark, type WatchedSparkEdit } from "./api";
import {
  DEFAULT_HUNTING,
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
  watchSpark?: (k: SlotFactorKind, key: number, body: WatchedSparkEdit) => Promise<WatchedSpark>;
  unwatchSpark?: (k: SlotFactorKind, key: number) => Promise<void>;
}) => {
  const calls = {
    watchedSparks: vi
      .spyOn(api, "watchedSparks")
      .mockImplementation(over.watchedSparks ?? (() => Promise.resolve([] as WatchedSpark[]))),
    watchSpark: vi.spyOn(api, "watchSpark").mockImplementation(
      over.watchSpark ??
        ((kind: SlotFactorKind, key: number, body: WatchedSparkEdit) =>
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

describe("toggle", () => {
  it("adds an unwatched spark as hunted, and appends what the server returned", async () => {
    const calls = stubApi({});
    const next = await toggle([], "white", 700);
    expect(calls.watchSpark).toHaveBeenCalledWith("white", 700, {
      hunting: DEFAULT_HUNTING,
      groups: [],
    });
    expect(next.map((s) => s.key)).toEqual([700]);
  });

  it("removes a watched one, and only that one", async () => {
    const calls = stubApi({});
    const rows = [watched({ id: 1, kind: "white", key: 700 }), watched({ id: 2, key: 800 })];
    const next = await toggle(rows, "white", 700);
    expect(calls.unwatchSpark).toHaveBeenCalledWith("white", 700);
    expect(calls.watchSpark).not.toHaveBeenCalled();
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
  it("sends the row's existing groups back unchanged", async () => {
    const calls = stubApi({});
    const rows = [watched({ id: 1, kind: "white", key: 700, hunting: true, groups: ["Front"] })];
    await setHunting(rows, "white", 700, false);
    expect(calls.watchSpark).toHaveBeenCalledWith("white", 700, {
      hunting: false,
      groups: ["Front"],
    });
    expect(calls.watchedSparks).not.toHaveBeenCalled();
  });

  it("adds a spark that isn't watched yet, with empty groups", async () => {
    const calls = stubApi({});
    const next = await setHunting([], "unique", 100_101, true);
    expect(calls.watchSpark).toHaveBeenCalledWith("unique", 100_101, {
      hunting: true,
      groups: [],
    });
    expect(next).toHaveLength(1);
  });

  // The rule the PUT's full-replace shape forces: a row can exist server-side
  // and be missing from this copy of the list, and guessing its other fields
  // there silently rewrites the user's own choice.
  it("re-reads before writing when the row is missing from this copy", async () => {
    const server = [watched({ id: 9, kind: "white", key: 700, hunting: true, groups: ["Mile"] })];
    const calls = stubApi({ watchedSparks: () => Promise.resolve(server) });
    await setHunting([], "white", 700, false);
    expect(calls.watchedSparks).toHaveBeenCalledOnce();
    expect(calls.watchSpark).toHaveBeenCalledWith("white", 700, {
      hunting: false,
      groups: ["Mile"],
    });
  });

  it("returns the re-read list with the saved row in it, not the stale one", async () => {
    const server = [
      watched({ id: 9, kind: "white", key: 700, groups: ["Mile"] }),
      watched({ id: 12, kind: "race", key: 4 }),
    ];
    stubApi({
      watchedSparks: () => Promise.resolve(server),
      watchSpark: (kind, key, body) => Promise.resolve(watched({ id: 9, kind, key, ...body })),
    });
    const next = await setHunting([], "white", 700, false);
    expect(next.map((s) => s.id)).toEqual([9, 12]);
    expect(next.find((s) => s.id === 9)).toMatchObject({ hunting: false, groups: ["Mile"] });
  });
});

describe("setGroups", () => {
  it("sends the row's existing hunting bit back unchanged", async () => {
    const calls = stubApi({});
    const rows = [watched({ id: 1, kind: "white", key: 700, hunting: false, groups: [] })];
    await setGroups(rows, "white", 700, ["Front"]);
    expect(calls.watchSpark).toHaveBeenCalledWith("white", 700, {
      hunting: false,
      groups: ["Front"],
    });
  });

  // The case the re-read exists for: guessing DEFAULT_HUNTING here would
  // re-hunt a spark the user had deliberately marked as filler on another tab.
  it("re-reads rather than guessing the bit, and does not re-hunt filler", async () => {
    const server = [watched({ id: 9, kind: "white", key: 700, hunting: false, groups: [] })];
    const calls = stubApi({ watchedSparks: () => Promise.resolve(server) });
    await setGroups([], "white", 700, ["Front"]);
    expect(calls.watchSpark).toHaveBeenCalledWith("white", 700, {
      hunting: false,
      groups: ["Front"],
    });
  });

  it("falls back to the default only when the spark really is new", async () => {
    const calls = stubApi({ watchedSparks: () => Promise.resolve([]) });
    await setGroups([], "white", 700, ["Front"]);
    expect(calls.watchSpark).toHaveBeenCalledWith("white", 700, {
      hunting: DEFAULT_HUNTING,
      groups: ["Front"],
    });
  });
});

describe("the returned list's order", () => {
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
    const server = [watched({ id: 1 }), watched({ id: 5 })];
    stubApi({
      watchedSparks: () => Promise.resolve(server),
      watchSpark: (kind, key, body) => Promise.resolve(watched({ id: 3, kind, key, ...body })),
    });
    const next = await setHunting([], "white", 3, true);
    expect(next.map((s) => s.id)).toEqual([1, 3, 5]);
  });

  it("appends when the new row is the newest", async () => {
    const server = [watched({ id: 1 }), watched({ id: 2 })];
    stubApi({
      watchedSparks: () => Promise.resolve(server),
      watchSpark: (kind, key, body) => Promise.resolve(watched({ id: 7, kind, key, ...body })),
    });
    const next = await setHunting([], "white", 7, true);
    expect(next.map((s) => s.id)).toEqual([1, 2, 7]);
  });
});
