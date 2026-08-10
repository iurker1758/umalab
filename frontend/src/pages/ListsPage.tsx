import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, detailOr, type FactorRef, type ListSparkKind, type SparkList } from "../api";
import { ListSparksPopout } from "../components/ListSparksPopout";
import { refocus } from "../components/refocus";
import { SPARK_TYPE_LABELS, sparkId } from "../procs";
import {
  deleteList,
  listById,
  loadActiveLists,
  loadSparkLists,
  moveList,
  PartialWrite,
  renameList,
  saveActiveLists,
  toggleActive,
  toggleMembership,
  type SparkListStore,
} from "../sparks";

// The management page (issue #70, DECISIONS.md #44): every list with its
// membership on display, rename, delete, reorder, and a per-list bulk-add
// popout. The ★ picker in the chooser stays the per-spark control; this page
// is the per-list one — and Delete is what closes the 50-list cap deadlock,
// which otherwise 409s every create with no in-app way to free a slot.
//
// The store is page-local, not lifted to App: pages refetch on mount, so a
// lifted copy would be the STALER one, and nothing user-held dies with this
// page on a route change.

/**
 * The name IS the field, the blueprint picker's idiom: renaming is typing
 * where the name already is, committed on blur. Keyed by the server's name
 * (unique per owner), so a landed rename or a cross-device change resets the
 * draft by remount — and a REFUSED rename changes no key, so the draft
 * survives for correction rather than snapping back (the ListPicker rule).
 */
function ListNameField({
  name,
  busy,
  onRename,
}: {
  name: string;
  busy: boolean;
  onRename: (name: string) => void;
}) {
  const [draft, setDraft] = useState(name);
  const commit = () => {
    const trimmed = draft.trim();
    // Blank reverts rather than deleting the name — a list, unlike a
    // blueprint, has no placeholder identity to fall back on.
    if (trimmed === "") {
      setDraft(name);
      return;
    }
    if (trimmed === name) return;
    onRename(trimmed);
  };
  return (
    <input
      className="list-name"
      type="text"
      aria-label="List Name"
      // Matches `SparkListName`'s bound, felt as the field refusing a 41st
      // character; the server still enforces it.
      maxLength={40}
      value={draft}
      disabled={busy}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      // `isComposing` guards the IME — confirming a candidate is an Enter
      // keydown too, and committing it would rename to pre-conversion kana.
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) e.currentTarget.blur();
      }}
    />
  );
}

export function ListsPage({ onError }: { onError: (msg: string) => void }) {
  const [lists, setLists] = useState<SparkList[]>([]);
  const [failed, setFailed] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [refs, setRefs] = useState<FactorRef[]>([]);
  const [active, setActive] = useState<number[]>(() => loadActiveLists());
  useEffect(() => saveActiveLists(active), [active]);
  const onToggleActive = useCallback(
    (id: number) => setActive((prev) => toggleActive(prev, id)),
    []
  );
  // One flag for every write surface on the page and in the popout — the
  // chooser's idiom, and what keeps the whole-array membership writes from
  // racing each other.
  const [busy, setBusy] = useState(false);
  // Which list's Add Sparks popout is open. Rendered through a live lookup,
  // so a list deleted elsewhere closes its own popout on the next adopt.
  const [openFor, setOpenFor] = useState<number | null>(null);

  // The Designer's write-vs-fetch guard, unchanged: a fetch already in
  // flight when a write lands is stale by definition.
  const writes = useRef(0);
  const onChange = useCallback((next: SparkList[]) => {
    writes.current += 1;
    setLists(next);
  }, []);
  const reload = useCallback(() => {
    void (async () => {
      const seen = writes.current;
      try {
        const rows = await loadSparkLists();
        if (writes.current === seen) setLists(rows);
        setFailed(false);
      } catch {
        setFailed(true);
      } finally {
        setEpoch((n) => n + 1);
      }
    })();
  }, []);
  useEffect(() => reload(), [reload]);
  useEffect(() => {
    let cancelled = false;
    void api.factors().then(
      (rows) => {
        if (!cancelled) setRefs(rows);
      },
      () => {
        // The membership still renders — as "Unknown (key)", the app-wide
        // degradation for a reference that isn't there.
        if (!cancelled) {
          onError("Couldn't load the spark reference — sparks show as keys.");
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [onError]);

  const store: SparkListStore = useMemo(
    () => ({
      lists,
      epoch,
      failed,
      active,
      onChange,
      onToggleActive,
      onReload: reload,
    }),
    [lists, epoch, failed, active, onChange, onToggleActive, reload]
  );

  const names = useMemo(
    () => new Map(refs.map((r) => [sparkId({ type: r.kind, key: r.key }), r.name])),
    [refs]
  );

  // The chooser's shared write shape: non-optimistic, one busy gate, a
  // PartialWrite's half-landed state adopted before the error is shown.
  const write = async (
    op: () => Promise<SparkList[]>,
    failure: (error: unknown) => string
  ): Promise<void> => {
    setBusy(true);
    try {
      onChange(await op());
    } catch (error) {
      if (error instanceof PartialWrite) onChange(error.lists);
      onError(failure(error));
    } finally {
      setBusy(false);
    }
  };

  const rename = (id: number, name: string) =>
    void write(
      () => renameList(lists, id, name),
      (e) => detailOr(e, "Couldn't rename the list — try again.")
    );

  const remove = (list: SparkList, control: HTMLElement | null) => {
    const what =
      list.sparks.length === 0
        ? `Delete "${list.name}"?`
        : `Delete "${list.name}" and the ${list.sparks.length} sparks in it?`;
    if (!window.confirm(what)) return;
    // Captured before the write: on success the button unmounts with its
    // row, and focus falls back to the row's remains or dies quietly (#74).
    const restore = refocus(control);
    void write(
      () => deleteList(lists, list.id),
      () => "Couldn't delete the list — try again."
    ).finally(restore);
  };

  const move = (id: number, direction: -1 | 1, control: HTMLElement | null) => {
    // Captured in the handler: a move to an end disables the very button
    // that was clicked, and the row restore covers it (#74).
    const restore = refocus(control);
    void write(
      () => moveList(lists, id, direction),
      () => "Couldn't move the list — try again."
    ).finally(restore);
  };

  const toggle = (kind: ListSparkKind, key: number, control: HTMLElement | null) => {
    if (openFor === null) return;
    const restore = refocus(control);
    void write(
      () => toggleMembership(lists, openFor, kind, key),
      (e) => detailOr(e, "Couldn't save that change — try again.")
    ).finally(restore);
  };

  const open = openFor === null ? undefined : listById(lists, openFor);

  return (
    <div className="lists-page">
      {failed && (
        <p className="list-fail">
          Couldn't load your lists.{" "}
          <button className="list-action" onClick={reload}>
            Retry
          </button>
        </p>
      )}
      {!failed && epoch > 0 && lists.length === 0 && (
        <p className="empty">
          No lists yet — star a spark in the designer to make one.
        </p>
      )}
      {lists.map((list, i) => (
        <section key={list.id} className="list-row" aria-label={list.name}>
          <div className="list-head">
            <ListNameField
              key={list.name}
              name={list.name}
              busy={busy || failed}
              onRename={(name) => rename(list.id, name)}
            />
            <div className="list-controls">
              <button
                className="list-move"
                aria-label={`Move ${list.name} up`}
                disabled={busy || failed || i === 0}
                onClick={(e) => move(list.id, -1, e.currentTarget)}
              >
                ▲
              </button>
              <button
                className="list-move"
                aria-label={`Move ${list.name} down`}
                disabled={busy || failed || i === lists.length - 1}
                onClick={(e) => move(list.id, 1, e.currentTarget)}
              >
                ▼
              </button>
              <button
                className="list-action"
                disabled={busy || failed}
                onClick={() => setOpenFor(list.id)}
              >
                Add Sparks
              </button>
              <button
                className="list-action list-delete"
                disabled={busy || failed}
                onClick={(e) => remove(list, e.currentTarget)}
              >
                Delete
              </button>
            </div>
          </div>
          {list.sparks.length > 0 ? (
            <ul className="list-chips">
              {list.sparks.map((s) => {
                const id = sparkId({ type: s.kind, key: s.key });
                return (
                  <li key={id} className="list-chip">
                    <span className={`proc-kind proc-kind-${s.kind}`}>
                      {SPARK_TYPE_LABELS[s.kind]}
                    </span>
                    {names.get(id) ?? `Unknown (${s.key})`}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="list-empty">Nothing in this list yet.</p>
          )}
        </section>
      ))}
      {open !== undefined && (
        <ListSparksPopout
          // Remounts when a retry lands, retaking the per-open snapshots —
          // the chooser's key, with the same narrow #89-shaped hazard.
          key={`${open.id}:${epoch}`}
          listId={open.id}
          store={store}
          refs={refs}
          busy={busy}
          onToggle={toggle}
          onClose={() => setOpenFor(null)}
        />
      )}
    </div>
  );
}
