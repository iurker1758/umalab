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
//
// The rule is stated ONCE, and not here: it is the `hunting` column's default
// (backend/app/models.py). It used to be a constant in this module because
// under a full-replace PUT only the client knew whether it was adding; a
// partial update means the row that doesn't exist yet is the server's to
// furnish (#64). A copy here would be a second answer to a question with one.

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

// ---------- the three mutators ----------
// Each sends only the field it is changing and hands back the caller's list
// with the ONE row the server returned folded in. Nothing re-reads the list
// first: the PUT is a partial update (#64), so a mutator never has to know —
// or guess — the field it isn't touching. Guessing one is what #62 was.
//
// That is the whole of the rule now, and it is not a guarantee of ordering:
// `setGroups` still sends a set it computed from the caller's list, so two
// devices editing the same spark's groups at once is last-write-wins (#66).
// What the shape removes is the far commoner loss, where a mutator writes
// over a field nobody touched.
//
// A write folds in one row rather than adopting a whole fresh list on
// purpose: the chooser freezes its Favorites membership at open and filters
// the kind sections against that snapshot (#35), so a row the snapshot has
// never seen would arrive as a filled star in a kind section — one click from
// deleting a favorite added on another device. Refreshing wholesale is
// `onReload`'s job, and it bumps `epoch` so the snapshot is retaken.

/**
 * Add the spark if it isn't watched, remove it if it is.
 *
 * The add is an empty body: "make sure this spark is watched." The server
 * creates it hunted (the column default) or leaves the existing row exactly
 * as it is, and returns whichever — so a spark watched on another device
 * keeps its groups and its filler bit, and the star still lands on. There is
 * nothing to decide client-side and nothing to look up first.
 *
 * The remove needs no lookup either: the DELETE route treats an already-gone
 * row as the outcome the caller wanted, so a stale "watched" costs one 204.
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
  return replacing(watched, await api.watchSpark(kind, key, {}));
}

/**
 * Set the hunting bit. A spark that isn't watched yet is ADDED by this — the
 * route is an upsert, and "hunt this" is a reason to want the row. Its groups
 * are left alone, which for a new row means empty.
 */
export async function setHunting(
  watched: WatchedSpark[],
  kind: SlotFactorKind,
  key: number,
  hunting: boolean
): Promise<WatchedSpark[]> {
  return replacing(watched, await api.watchSpark(kind, key, { hunting }));
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
  return replacing(watched, await api.watchSpark(kind, key, { groups }));
}
