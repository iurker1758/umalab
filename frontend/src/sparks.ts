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

// The list plus everything a consumer needs to render and write it, as ONE
// prop. The chooser sits three levels below the page that owns the fetch
// (DesignerPage → FocusPanel → NodeProcs → SparkChooser), and passing the
// five pieces separately meant declaring, typing and forwarding five props
// at every level for a leaf that reads them — four files touched to add one
// field. #27's watched block is the next consumer of the same list and would
// have repeated the edit.
export type WatchedStore = {
  list: WatchedSpark[];
  // Which generation of `list` this is. Zero until the first fetch SETTLES,
  // then bumped by every fetch that lands, INCLUDING a retry — which an
  // "already loaded" boolean cannot express, because a retry only ever
  // happens once loading is over.
  //
  // The chooser keys its popout on this, so a retry that succeeds while the
  // popout is open re-snapshots its Favorites section instead of leaving it
  // frozen empty. Writes deliberately do NOT bump it: the frozen membership
  // is what keeps a row from moving out from under the pointer that starred
  // it.
  epoch: number;
  // Whether the LAST attempt rejected, which an empty list cannot say — a
  // user with no favorites yet and a user whose fetch failed hold the same
  // array, and only one of them has a reason to see the controls disabled.
  failed: boolean;
  // Hand back the list the server ended up with. Non-optimistic by design:
  // the mutators in this module return it, so a star only moves once the row
  // exists.
  onChange: (next: WatchedSpark[]) => void;
  onReload: () => void;
};

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

// The PUT is a full replace, so every mutator has to send the fields it is
// NOT changing — and must not guess them. A row can exist server-side and be
// missing from this list (another tab, another device, a list fetched before
// it was added, a fetch that failed and left it empty), and guessing there
// silently rewrites the user's own choice: `setGroups` assuming
// `hunting: true` would re-hunt a spark they had deliberately marked as
// filler. So on a miss, re-read before writing, and only fall back to the
// defaults if it really is new.
//
// All three mutators go through this. `toggle` skipping it was issue #62: the
// list being the caller's is what makes the reads pure (DECISIONS.md #33),
// and the price of that is that no mutator may treat absence from it as
// absence from the server.
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
 * Add the spark if it isn't watched, remove it if it is.
 *
 * "Isn't watched" is decided against the SERVER on the add path, not against
 * the caller's list — see `currentOrFresh`. The remove path needs no re-read:
 * the DELETE route treats an already-gone row as the outcome the caller
 * wanted, so a stale "watched" costs one 204 and nothing else.
 *
 * When the re-read finds the row after all, the click's intent — "I want this
 * watched" — is already true, so this returns the list it read and writes
 * NOTHING. The star lands on and the row keeps the groups and the hunting bit
 * it had. Removing it instead would be the other reading of "toggle", and it
 * would delete a row the user never saw, which is worse than the stale star
 * it would be correcting.
 */
export async function toggle(
  watched: WatchedSpark[],
  kind: SlotFactorKind,
  key: number
): Promise<WatchedSpark[]> {
  if (isWatched(watched, kind, key)) {
    await api.unwatchSpark(kind, key);
    return watched.filter((spark) => !same(spark, kind, key));
  }
  const { row, list } = await currentOrFresh(watched, kind, key);
  if (row !== undefined) return list;
  const saved = await api.watchSpark(kind, key, {
    hunting: DEFAULT_HUNTING,
    groups: [],
  });
  return replacing(list, saved);
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
