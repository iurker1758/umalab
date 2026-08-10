import { useEffect, useState } from "react";
import {
  LIST_SPARK_KINDS,
  type FactorRef,
  type ListSparkKind,
  type SparkList,
} from "../api";
import { SPARK_TYPE_LABELS, SPARK_TYPE_ORDER, sparkId } from "../procs";
import { byQueryRank } from "../rank";

// The membership editor for ONE list (issue #70): every listable spark as a
// row that toggles, so building a "Front Runner" list is one open instead of
// forty trips through the chooser. NOT the chooser's popout — that one is
// bound to a slot document (star levels, greens, a pink), and none of it
// applies to a list, which records WHICH sparks and never the level
// (DECISIONS.md #37). No list filter either: this surface edits one list,
// and what OTHER lists hold is a different question with its own control
// (the proc panels' Lists disclosure, DECISIONS.md #43).
//
// Writes are per-toggle and non-optimistic like every list surface: a row's
// +/✕ moves once the server's array says so, and Escape can close at any
// moment without discarding staged work because nothing is ever staged.

type Option = { kind: ListSparkKind; key: number; name: string };

// The listable kinds in the tables' grouping order, so the sections here
// match the chooser's.
const KINDS = [...LIST_SPARK_KINDS].sort(
  (a, b) => SPARK_TYPE_ORDER[a] - SPARK_TYPE_ORDER[b]
);

export function ListSparksPopout({
  list,
  refs,
  busy,
  onToggle,
  onClose,
}: {
  // The parent's LIVE copy: membership moves only when the server answers,
  // and a list deleted on another device unmounts this whole popout through
  // the parent's render guard.
  list: SparkList;
  refs: FactorRef[];
  busy: boolean;
  // The write and its focus restore live with the page's shared wrapper; the
  // control rides along so the restore can capture it before state moves.
  onToggle: (kind: ListSparkKind, key: number, control: HTMLElement | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");

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
  // WHICH rows sit in the In This List section, snapshotted for the life of
  // this open — the chooser's Favorites shape (DECISIONS.md #35/#36), for
  // its reasons: un-toggling a member keeps its row in place with a "+", so
  // a mis-tap is recoverable where it happened and nothing moves under the
  // pointer. Held-ness stays live off the list. Members the reference can't
  // name ride along as "Unknown (key)" rows — this popout is their only
  // removal surface, and up here is where their owner looks for them.
  //
  // In section order, membership order within a kind: rows carry no kind
  // tag (the name's colour says it, #41's rule), so the grouping is what
  // keeps a mixed run legible.
  const [pinned] = useState<{ kind: ListSparkKind; key: number }[]>(() =>
    [...list.sparks]
      .sort((a, b) => SPARK_TYPE_ORDER[a.kind] - SPARK_TYPE_ORDER[b.kind])
      .map((s) => ({ kind: s.kind, key: s.key }))
  );
  const pinnedIds = new Set(pinned.map((s) => sparkId({ type: s.kind, key: s.key })));
  const held = new Set(list.sparks.map((s) => sparkId({ type: s.kind, key: s.key })));

  const q = query.trim().toLowerCase();
  const byQuery = byQueryRank(q);
  const matching = (options: Option[]): Option[] => {
    const hits = options.filter((o) => o.name.toLowerCase().includes(q));
    return q === "" ? hits : hits.sort(byQuery);
  };

  // A member at open is up top and NOWHERE ELSE — the same spark twice on
  // one surface reads as "which of these did I already have" (the chooser's
  // dedup rule). In membership order, the order the list renders everywhere.
  const sections = [
    {
      head: "In This List",
      options: matching(
        pinned.map((s) => ({
          ...s,
          name: names.get(sparkId({ type: s.kind, key: s.key })) ?? `Unknown (${s.key})`,
        }))
      ),
    },
    ...KINDS.map((kind) => ({
      head: SPARK_TYPE_LABELS[kind],
      options: matching(
        refs
          .filter(
            (r) => r.kind === kind && !pinnedIds.has(sparkId({ type: r.kind, key: r.key }))
          )
          .map((r) => ({ kind, key: r.key, name: r.name }))
      ),
    })),
  ].filter((s) => s.options.length > 0);

  return (
    <>
      {/* Dismisses on mousedown, not click — the chooser's cursor-freeze
          workaround, kept identical. */}
      <div className="uma-popout-backdrop" onMouseDown={onClose} />
      <div
        className="uma-popout spark-popout"
        role="dialog"
        aria-label={`Edit sparks in ${list.name}`}
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
        </div>
        <div className="spark-sections">
          {sections.map((s) => (
            <div key={s.head} className="spark-section">
              <div className="spark-section-head">{s.head}</div>
              <ul className="list-picks">
                {s.options.map((o) => {
                  const id = sparkId({ type: o.kind, key: o.key });
                  const holds = held.has(id);
                  return (
                    <li key={id}>
                      <button
                        className={`list-toggle proc-row-${o.kind}${holds ? " active" : ""}`}
                        aria-pressed={holds}
                        data-spark={id}
                        data-list={list.id}
                        aria-label={
                          holds
                            ? `Remove ${o.name} from ${list.name}`
                            : `Add ${o.name} to ${list.name}`
                        }
                        disabled={busy}
                        onClick={(e) => onToggle(o.kind, o.key, e.currentTarget)}
                      >
                        {/* No kind tag: the section head or the name's own
                            colour says it (#41 — kind owns colour). */}
                        <span className="spark-hit proc-name">{o.name}</span>
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
