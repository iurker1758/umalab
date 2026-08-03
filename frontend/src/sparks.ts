import { api, type SlotFactorKind, type WatchedSpark } from "./api";

// The sparks this user cares about — one list, shared by every feature that
// needs to ask that question (DECISIONS.md #33).
//
// Its own module rather than domain.ts or filters.ts: both of those hold
// roster-page state, and this is read by designer surfaces — the spark
// chooser (#28), the proc tables' watched block (#27) and hunted-skill
// scoring. Living in filters.ts would also invite a `reconcile` pass by
// proximity, which is exactly what this list must not have.
//
// SERVER-BACKED, not localStorage: it spans devices and it belongs to a
// user, so it is a row rather than a browser preference (#33 covers why the
// four view-state stores stayed local). That makes the mutators async and
// the reads pure functions over a list the caller holds — the alternative,
// a module-held cache with synchronous `isWatched()`, would be a second copy
// of server state with no way to know it had gone stale.

export type { WatchedSpark } from "./api";

// A newly added spark is hunted. Adding is a deliberate pick — the spark,
// then its star level — which reads as "I want this outcome"; defaulting to
// false would leave #27's watched block empty on first use, with the bit
// that fills it one the user has never seen. Filler you only want handy for
// typing is one click off at the moment you add it.
export const DEFAULT_HUNTING = true;

const same = (spark: WatchedSpark, kind: SlotFactorKind, key: number) =>
  spark.kind === kind && spark.key === key;

const find = (watched: WatchedSpark[], kind: SlotFactorKind, key: number) =>
  watched.find((spark) => same(spark, kind, key));

// ---------- reads ----------
// Pure over the list the caller already has in state, so a row can be
// rendered without a fetch per cell.

export const isWatched = (
  watched: WatchedSpark[],
  kind: SlotFactorKind,
  key: number
): boolean => find(watched, kind, key) !== undefined;

// Unwatched reads as not hunted, so a caller asks one question instead of two.
export const isHunting = (
  watched: WatchedSpark[],
  kind: SlotFactorKind,
  key: number
): boolean => find(watched, kind, key)?.hunting === true;

export const groupsOf = (
  watched: WatchedSpark[],
  kind: SlotFactorKind,
  key: number
): string[] => find(watched, kind, key)?.groups ?? [];

// Insertion order, oldest first — the server orders by row id. With a group
// name, only that build's sparks: a filter over the one list, never a second
// store.
export const list = (watched: WatchedSpark[], group?: string): WatchedSpark[] =>
  group === undefined
    ? watched
    : watched.filter((spark) => spark.groups.includes(group));

// Every group name in use, in the order it was first written. What a group
// control renders; there is no separate registry, so a group exists exactly
// as long as a spark is in it.
export const groupNames = (watched: WatchedSpark[]): string[] => [
  ...new Set(watched.flatMap((spark) => spark.groups)),
];

// ---------- writes ----------
// Each returns the new list, which is what the caller puts back in state.
// The server is the authority on order and on what a row ended up holding,
// so the returned row replaces the local one rather than being merged into
// it.

const replacing = (
  watched: WatchedSpark[],
  saved: WatchedSpark
): WatchedSpark[] => {
  const index = watched.findIndex((spark) => same(spark, saved.kind, saved.key));
  if (index >= 0) {
    const next = [...watched];
    next[index] = saved;
    return next;
  }
  // Not in this copy of the list — it may predate the row (another tab, another
  // device). Insert by id rather than appending: id IS the insertion order the
  // server sorts by, so appending would show an old spark last.
  const at = watched.findIndex((spark) => spark.id > saved.id);
  return at < 0
    ? [...watched, saved]
    : [...watched.slice(0, at), saved, ...watched.slice(at)];
};

export const loadWatched = (): Promise<WatchedSpark[]> => api.watchedSparks();

/** Add the spark if it isn't watched, remove it if it is. */
export async function toggle(
  watched: WatchedSpark[],
  kind: SlotFactorKind,
  key: number
): Promise<WatchedSpark[]> {
  if (isWatched(watched, kind, key)) {
    await api.unwatchSpark(kind, key);
    return watched.filter((spark) => !same(spark, kind, key));
  }
  const saved = await api.watchSpark(kind, key, {
    hunting: DEFAULT_HUNTING,
    groups: [],
  });
  return [...watched, saved];
}

// The PUT is a full replace, so every mutator has to send the fields it is
// NOT changing — and must not guess them. A row can exist server-side and be
// missing from this list (another tab, another device, a list fetched before
// it was added), and guessing there silently rewrites the user's own choice:
// `setGroups` assuming `hunting: true` would re-hunt a spark they had
// deliberately marked as filler. So on a miss, re-read before writing, and
// only fall back to the defaults if it really is new.
async function currentOrFresh(
  watched: WatchedSpark[],
  kind: SlotFactorKind,
  key: number
): Promise<{ row: WatchedSpark | undefined; list: WatchedSpark[] }> {
  const row = find(watched, kind, key);
  if (row !== undefined) return { row, list: watched };
  const fresh = await loadWatched();
  return { row: find(fresh, kind, key), list: fresh };
}

/**
 * Set the hunting bit. A spark that isn't watched yet is ADDED by this — the
 * server route is an upsert, and "hunt this" is a reason to want the row.
 * Its groups start empty, exactly as `toggle` would leave them.
 */
export async function setHunting(
  watched: WatchedSpark[],
  kind: SlotFactorKind,
  key: number,
  hunting: boolean
): Promise<WatchedSpark[]> {
  const { row, list } = await currentOrFresh(watched, kind, key);
  const saved = await api.watchSpark(kind, key, {
    hunting,
    groups: row?.groups ?? [],
  });
  return replacing(list, saved);
}

/**
 * Replace the row's whole group set. Whole set rather than add/remove pairs:
 * the caller has the current groups from `groupsOf`, and two endpoints would
 * need the same de-duplication twice. Duplicates collapse server-side.
 */
export async function setGroups(
  watched: WatchedSpark[],
  kind: SlotFactorKind,
  key: number,
  groups: string[]
): Promise<WatchedSpark[]> {
  const { row, list } = await currentOrFresh(watched, kind, key);
  const saved = await api.watchSpark(kind, key, {
    hunting: row?.hunting ?? DEFAULT_HUNTING,
    groups,
  });
  return replacing(list, saved);
}
