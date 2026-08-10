import { useEffect, useState } from "react";
import {
  LIST_SPARK_KINDS,
  type FactorRef,
  type ListSparkKind,
  type SparkList,
} from "../api";
import { ListFilter } from "./ListFilter";
import { SPARK_TYPE_LABELS, SPARK_TYPE_ORDER, sparkId } from "../procs";
import { byQueryRank } from "../rank";
import { listById, type SparkListStore } from "../sparks";

// The bulk-add browser for ONE list (issue #70): every listable spark as a
// row that toggles membership, so building a "Front Runner" list is one open
// instead of forty trips through the chooser. NOT the chooser's popout —
// that one is bound to a slot document (star levels, greens, a pink), and
// none of it applies to a list, which records WHICH sparks and never the
// level (DECISIONS.md #37).
//
// Writes are per-toggle and non-optimistic like every list surface: a row's
// +/✕ moves once the server's array says so, and Escape can close at any
// moment without discarding staged work because nothing is ever staged.

type Option = { kind: ListSparkKind; key: number; name: string };

const membershipIds = (list: SparkList): Set<string> =>
  new Set(list.sparks.map((s) => sparkId({ type: s.kind, key: s.key })));

// The listable kinds in the tables' grouping order, so the sections here
// match the chooser's.
const KINDS = [...LIST_SPARK_KINDS].sort(
  (a, b) => SPARK_TYPE_ORDER[a] - SPARK_TYPE_ORDER[b]
);

export function ListSparksPopout({
  listId,
  store,
  refs,
  busy,
  onToggle,
  onClose,
}: {
  listId: number;
  store: SparkListStore;
  refs: FactorRef[];
  busy: boolean;
  // The write and its focus restore live with the page's shared wrapper; the
  // control rides along so the restore can capture it before state moves.
  onToggle: (kind: ListSparkKind, key: number, control: HTMLElement | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  // Membership read LIVE off the store, so a toggle moves only when the
  // server answers — and a list deleted on another device unmounts this
  // whole popout through the parent's render guard.
  const list = listById(store.lists, listId);

  // The filter pills, pressed-with-snapshot exactly as the chooser does
  // (its rationale on lifetime and staleness applies unchanged): presses
  // persist through `onToggleActive` as the active selection, the persisted
  // selection pre-presses at open, and a stale active id contributes
  // nothing. Pressing THIS list's own pill is the review mode — the browse
  // narrows to what the list holds.
  const [filters, setFilters] = useState<Map<number, Set<string>>>(() => {
    const init = new Map<number, Set<string>>();
    for (const id of store.active) {
      const pressed = listById(store.lists, id);
      if (pressed !== undefined) init.set(id, membershipIds(pressed));
    }
    return init;
  });
  const toggleListFilter = (id: number) => {
    setFilters((prev) => {
      const next = new Map(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        const pressed = listById(store.lists, id);
        next.set(id, pressed === undefined ? new Set() : membershipIds(pressed));
      }
      return next;
    });
    store.onToggleActive(id);
  };

  // Escape closes UNCONDITIONALLY, including mid-write — the chooser's rule,
  // for its reasons.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const names = new Map(refs.map((r) => [sparkId({ type: r.kind, key: r.key }), r.name]));
  // Members the reference can't name, frozen per open: each gets a degraded
  // row in its kind section, because this popout is their only removal
  // surface — and frozen, a just-removed row stays in place under the
  // pointer rather than vanishing with its own ✕ click.
  const [orphanRows] = useState<{ kind: ListSparkKind; key: number }[]>(() =>
    (list?.sparks ?? [])
      .filter((s) => !names.has(sparkId({ type: s.kind, key: s.key })))
      .map((s) => ({ kind: s.kind, key: s.key }))
  );
  // Membership at open, for the filter exemption below — a spark removed
  // during this open must keep its row even under a pressed list that never
  // held it.
  const [heldAtOpen] = useState(() => new Set(list === undefined ? [] : membershipIds(list)));

  if (list === undefined) return null;
  const held = membershipIds(list);

  const q = query.trim().toLowerCase();
  // The chooser's narrowing rules, minus the kinds a list cannot name: the
  // pressed lists union, an empty union imposes no filter, the query
  // BYPASSES the pills (this popout is an add surface, and a persisted
  // selection must not make a spark unaddable by its exact name), and rows
  // held now or at open are exempt so membership edits never move a row.
  const listIds = (() => {
    const flat = new Set([...filters.values()].flatMap((ids) => [...ids]));
    return flat.size === 0 ? null : flat;
  })();
  const inFilter = (id: string) =>
    listIds === null || q !== "" || listIds.has(id) || heldAtOpen.has(id) || held.has(id);
  const byQuery = byQueryRank(q);
  const matching = (options: Option[]): Option[] => {
    const hits = options.filter(
      (o) =>
        o.name.toLowerCase().includes(q) &&
        inFilter(sparkId({ type: o.kind, key: o.key }))
    );
    return q === "" ? hits : hits.sort(byQuery);
  };

  const sections = KINDS.map((kind) => ({
    kind,
    options: matching([
      // Orphans first — the same placement rule as the chooser: "Unknown
      // (key)" belongs nowhere in the alphabet, and appended it sits where
      // no one looks.
      ...orphanRows
        .filter((s) => s.kind === kind)
        .map((s) => ({ ...s, name: `Unknown (${s.key})` })),
      ...refs
        .filter((r) => r.kind === kind)
        .map((r) => ({ kind, key: r.key, name: r.name })),
    ]),
  })).filter((s) => s.options.length > 0);

  return (
    <>
      {/* Dismisses on mousedown, not click — the chooser's cursor-freeze
          workaround, kept identical. */}
      <div className="uma-popout-backdrop" onMouseDown={onClose} />
      <div
        className="uma-popout spark-popout"
        role="dialog"
        aria-label={`Add sparks to ${list.name}`}
      >
        <div className="spark-search-band">
          <div className="list-popout-title">{list.name}</div>
          <input
            className="uma-search"
            type="search"
            aria-label={`Spark search for ${list.name}`}
            placeholder="Search Sparks…"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="spark-filter-row">
            <ListFilter
              lists={store.lists}
              isPressed={(id) => filters.has(id)}
              disabled={busy || store.failed}
              onToggle={toggleListFilter}
            />
          </div>
        </div>
        <div className="spark-sections">
          {sections.map((s) => (
            <div key={s.kind} className="spark-section">
              <div className="spark-section-head">{SPARK_TYPE_LABELS[s.kind]}</div>
              <ul className="list-picks">
                {s.options.map((o) => {
                  const id = sparkId({ type: o.kind, key: o.key });
                  const holds = held.has(id);
                  return (
                    <li key={id}>
                      <button
                        className={holds ? "list-toggle active" : "list-toggle"}
                        aria-pressed={holds}
                        data-spark={id}
                        data-list={list.id}
                        aria-label={
                          holds
                            ? `Remove ${o.name} from ${list.name}`
                            : `Add ${o.name} to ${list.name}`
                        }
                        disabled={busy || store.failed}
                        onClick={(e) => onToggle(o.kind, o.key, e.currentTarget)}
                      >
                        <span className={`proc-kind proc-kind-${o.kind}`}>
                          {SPARK_TYPE_LABELS[o.kind]}
                        </span>
                        <span className="spark-hit">{o.name}</span>
                        <span className="spark-list-mark" aria-hidden="true">
                          {holds ? "✕" : "+"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
        {sections.length === 0 && <span className="empty">No sparks match.</span>}
      </div>
    </>
  );
}
