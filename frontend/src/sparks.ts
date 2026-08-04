import { api, type SlotFactorKind, type SparkList, type SparkRef } from "./api";
import { writeStore } from "./storage";

// The user's named spark lists — "Front Runner", "Medium" — and the reads
// every feature does over them (DECISIONS.md #37).
//
// Its own module rather than domain.ts or filters.ts: both of those hold
// roster-page state, and this is read by designer surfaces — the spark
// chooser's Favorites section (#28), the proc tables' watched block (#27) and
// hunted-skill scoring. Living in filters.ts would also invite a `reconcile`
// pass by proximity, which is exactly what these lists must not have.
//
// THE LISTS ARE SERVER-BACKED; WHICH ONES ARE ACTIVE IS NOT. A list belongs
// to a user and spans devices, so it is a row. Which of them you are working
// against right now is a view, so it is `localStorage` beside the four stores
// of #32 — the phone being on a different build from the desktop is a feature.
//
// That makes the mutators async and the reads pure functions over lists the
// caller holds. The alternative, a module-held cache with a synchronous
// `isFavorite()`, would be a second copy of server state with no way to know
// it had gone stale.

export type { SparkList, SparkRef } from "./api";

// Which lists the user is working against, per device. Multi-select, because
// a week can be about two builds at once — which is also why the ★ opens a
// picker rather than adding to "the" active list (DECISIONS.md #37).
export const ACTIVE_LISTS_STORE = "umalab.sparkLists.active";

// Everything a consumer needs to render and write the lists, as ONE prop. The
// chooser sits three levels below the page that owns the fetch (DesignerPage →
// FocusPanel → NodeProcs → SparkChooser), and passing the pieces separately
// meant declaring, typing and forwarding each of them at every level for a
// leaf that reads them — four files touched to add one field. #27's watched
// block is the next consumer of the same lists and would have repeated it.
export type SparkListStore = {
  lists: SparkList[];
  // Which generation of `lists` this is. Zero until the first fetch SETTLES,
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
  // Whether the LAST attempt rejected, which an empty array cannot say — a
  // user with no lists yet and a user whose fetch failed hold the same value,
  // and only one of them has a reason to see the controls disabled.
  failed: boolean;
  // The ids of the lists in play on THIS device. Empty means "everything",
  // not "nothing" — see `activeSparks`.
  active: number[];
  // Hand back what the server ended up with. Non-optimistic by design: the
  // mutators in this module return it, so a checkbox only moves once the row
  // says so.
  onChange: (next: SparkList[]) => void;
  onActiveChange: (next: number[]) => void;
  onReload: () => void;
};

const sameSpark = (spark: SparkRef, kind: SlotFactorKind, key: number) =>
  spark.kind === kind && spark.key === key;

const refId = (spark: SparkRef) => `${spark.kind}:${spark.key}`;

// ---------- reads ----------
// Pure over the lists the caller already has in state, so a row can be
// rendered without a fetch per cell.

export const listById = (
  lists: SparkList[],
  id: number
): SparkList | undefined => lists.find((list) => list.id === id);

/** Every list holding this spark, in the order the lists are in. What the
 *  picker checks its boxes from. */
export const listsWith = (
  lists: SparkList[],
  kind: SlotFactorKind,
  key: number
): SparkList[] =>
  lists.filter((list) => list.sparks.some((s) => sameSpark(s, kind, key)));

/** In at least one list — what the ★ renders. There is no watched-but-in-no-
 *  list state any more: Favorites IS the union (DECISIONS.md #37). */
export const isFavorite = (
  lists: SparkList[],
  kind: SlotFactorKind,
  key: number
): boolean =>
  lists.some((list) => list.sparks.some((s) => sameSpark(s, kind, key)));

/**
 * The union of the given lists, deduped, first occurrence winning.
 *
 * List order then membership order, which is the order the server sorts by
 * and the order the user arranged. Deduped because a spark in two builds must
 * render once — #33 got that free by having one row in two groups, and this
 * shape has to solve it at read time instead.
 */
export const union = (lists: SparkList[]): SparkRef[] => {
  const seen = new Map<string, SparkRef>();
  for (const list of lists) {
    for (const spark of list.sparks) {
      if (!seen.has(refId(spark))) seen.set(refId(spark), spark);
    }
  }
  return [...seen.values()];
};

/** Everything the user has anywhere — the chooser's Favorites section. */
export const favorites = (lists: SparkList[]): SparkRef[] => union(lists);

/**
 * The sparks in play: the union of the ACTIVE lists.
 *
 * **Nothing selected means everything**, not nothing. Every user starts with
 * no lists and no selection, and a block that renders empty on first use
 * reads as broken rather than as unconfigured (DECISIONS.md #37). Ids that no
 * longer name a list are ignored rather than reconciled — a list deleted on
 * another device leaves a stale id here, and dropping it silently is the
 * whole of the handling.
 */
export const activeSparks = (
  lists: SparkList[],
  active: number[]
): SparkRef[] => {
  const chosen = lists.filter((list) => active.includes(list.id));
  return union(chosen.length === 0 ? lists : chosen);
};

/** Every list name in use, in the user's order — what a selector renders. */
export const listNames = (lists: SparkList[]): string[] =>
  lists.map((list) => list.name);

// ---------- the active selection (device-local) ----------

/**
 * The ids this device has selected. Shape-checked in full and falling back to
 * "none selected", which is the same as "everything" — so a corrupt key
 * degrades to showing more than you asked for rather than to an empty block.
 */
export function loadActiveLists(store: string = ACTIVE_LISTS_STORE): number[] {
  try {
    const raw = localStorage.getItem(store);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (
        Array.isArray(parsed) &&
        parsed.every((id) => typeof id === "number" && Number.isInteger(id))
      ) {
        return parsed;
      }
    }
  } catch {
    // absent, blocked, or not JSON — fall through to the default
  }
  return [];
}

export const saveActiveLists = (
  active: number[],
  store: string = ACTIVE_LISTS_STORE
): void => writeStore(store, active);

/** Select or deselect one list. Pure — the caller persists what it gets. */
export const toggleActive = (active: number[], id: number): number[] =>
  active.includes(id) ? active.filter((n) => n !== id) : [...active, id];

// ---------- writes ----------
// Each returns the new array of lists, which is what the caller puts back in
// state. The server is the authority on order and on what a list ended up
// holding, so a returned list replaces the local one rather than being merged
// into it.
//
// A write folds in the ONE list it touched rather than adopting a whole fresh
// fetch on purpose: the chooser freezes its Favorites membership at open and
// filters the kind sections against that snapshot (#35), so a spark the
// snapshot has never seen would arrive as a filled ★ in a kind section.
// Refreshing wholesale is `onReload`'s job, and it bumps `epoch` so the
// snapshot is retaken.

/** Server order: position, ties on id. Applied after every write so a
 *  reorder lands where the next GET would put it. */
const ordered = (lists: SparkList[]): SparkList[] =>
  [...lists].sort((a, b) => a.position - b.position || a.id - b.id);

const replacing = (lists: SparkList[], saved: SparkList): SparkList[] =>
  ordered(
    lists.some((list) => list.id === saved.id)
      ? lists.map((list) => (list.id === saved.id ? saved : list))
      : [...lists, saved]
  );

export const loadSparkLists = (): Promise<SparkList[]> => api.sparkLists();

/**
 * Create an empty list. The picker's `New List`, which is the only way one
 * gets made — creating and filling are separate requests, and a list with
 * nothing in it is a normal state (DECISIONS.md #37).
 *
 * Rejects with a 409 `ApiError` if the name is taken. Surfaced rather than
 * swallowed: the picker has a field the user can correct.
 */
export async function createList(
  lists: SparkList[],
  name: string
): Promise<SparkList[]> {
  return replacing(lists, await api.createSparkList(name));
}

/**
 * A write whose first half committed and whose second half did not, carrying
 * the state the caller must adopt anyway.
 *
 * Thrown rather than returned so a caller cannot mistake it for success, and
 * carrying `lists` because throwing alone would strand a row that really
 * exists: the caller has to both show the error AND fold in what landed.
 */
export class PartialWrite extends Error {
  constructor(
    readonly lists: SparkList[],
    readonly reason: unknown
  ) {
    super("the list was created but its membership was not saved");
    this.name = "PartialWrite";
  }
}

/**
 * Create a list and put this spark in it — the picker's `New List`, which is
 * always reached while starring something.
 *
 * Two round trips, because creating and filling are two routes. Worth it over
 * a "create with members" body: the create is rare, and one shape for
 * membership means the picker's checkbox and its new-list field cannot drift.
 *
 * **If the create succeeds and the fill fails, the created list is still
 * handed back** — as `PartialWrite.lists`. An earlier cut let the whole
 * promise reject, which discarded a row the server had committed: the list
 * appeared nowhere, so there was no pill to retry on, and re-typing the same
 * name 409'd forever on a list the user could not see. Surfacing it empty
 * means the next click on its pill finishes the job, which is what the
 * comment here used to claim without the code doing it.
 *
 * The reverse order would be worse: a spark added to a list that then failed
 * to be named has nowhere to live.
 */
export async function createListWith(
  lists: SparkList[],
  name: string,
  kind: SlotFactorKind,
  key: number
): Promise<SparkList[]> {
  const created = await api.createSparkList(name);
  const withList = replacing(lists, created);
  try {
    return await setMembership(withList, created.id, [{ kind, key }]);
  } catch (reason) {
    throw new PartialWrite(withList, reason);
  }
}

export async function renameList(
  lists: SparkList[],
  id: number,
  name: string
): Promise<SparkList[]> {
  return replacing(lists, await api.updateSparkList(id, { name }));
}

/**
 * Delete the list and everything in it.
 *
 * A spark in no other list leaves Favorites with it, which is the point of
 * the union: nothing is orphaned and there is nothing to sweep.
 */
export async function deleteList(
  lists: SparkList[],
  id: number
): Promise<SparkList[]> {
  await api.deleteSparkList(id);
  return lists.filter((list) => list.id !== id);
}

/**
 * Replace one list's membership wholesale.
 *
 * Whole set rather than add/remove pairs, matching the route: the caller has
 * the current membership from the list it holds, and two endpoints would need
 * the same de-duplication twice. The cost is that two devices editing one
 * list in the same moment is last-write-wins — accepted, and #37 says what
 * closing it would take.
 */
export async function setMembership(
  lists: SparkList[],
  id: number,
  sparks: SparkRef[]
): Promise<SparkList[]> {
  return replacing(lists, await api.updateSparkList(id, { sparks }));
}

/**
 * Add the spark to that list, or take it out if it is already there. One
 * checkbox in the picker.
 *
 * Computed from the caller's copy of the list, so a list changed on another
 * device since the last fetch is written from a stale set — the
 * last-write-wins case above, at its narrowest.
 *
 * A list the caller does not have is a no-op rather than a create: the id
 * came from a control rendered off these same lists, so its absence means the
 * list was deleted, and re-creating it would resurrect what another device
 * just removed.
 */
export async function toggleMembership(
  lists: SparkList[],
  id: number,
  kind: SlotFactorKind,
  key: number
): Promise<SparkList[]> {
  const list = listById(lists, id);
  if (list === undefined) return lists;
  const held = list.sparks.some((s) => sameSpark(s, kind, key));
  const sparks = held
    ? list.sparks.filter((s) => !sameSpark(s, kind, key))
    : [...list.sparks, { kind, key }];
  return setMembership(lists, id, sparks);
}
