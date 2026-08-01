import { useState } from "react";
import type { FactorRef, SlotFactor } from "../api";
import { SPARK_TYPE_LABELS, sparkId } from "../procs";

// Hand entry for a member's non-pink sparks. The pink editor is a fixed
// ten-aptitude select; these are 400-odd factors across four kinds and a
// member carries several, so this is a search-and-add list instead.
//
// A roster or lineage pick never needs it — hers are decoded from the dump —
// so this only appears on hand-built nodes, which is also why it is not
// offered inside a locked branch.
export function SparkEditor({
  label,
  factors,
  refs,
  onChange,
}: {
  // Distinguishes the editors on one page for aria/testing, as the pink one
  // does.
  label: string;
  factors: readonly SlotFactor[];
  refs: readonly FactorRef[];
  onChange: (factors: SlotFactor[]) => void;
}) {
  const [query, setQuery] = useState("");
  const held = new Set(factors.map((f) => `${f.kind}:${f.key}`));
  const q = query.trim().toLowerCase();
  // Only search once there's something to search for: 400 rows under every
  // ancestor panel is a list nobody reads, and the control is an "add one"
  // affordance rather than a browser.
  const matches =
    q === ""
      ? []
      : refs
          .filter((r) => !held.has(`${r.kind}:${r.key}`) && r.name.toLowerCase().includes(q))
          .slice(0, 8);
  const add = (ref: FactorRef) => {
    // New sparks start at 1★ — the honest default for one you're planning to
    // hunt, where the pink editor's 3★ default reflects a spark you already
    // know the shape of.
    onChange([...factors, { kind: ref.kind, key: ref.key, stars: 1 }]);
    setQuery("");
  };
  const nameOf = (f: SlotFactor) =>
    refs.find((r) => r.kind === f.kind && r.key === f.key)?.name ?? `Unknown (${f.key})`;
  return (
    <div className="spark-add">
      {factors.length > 0 && (
        <ul className="spark-list">
          {factors.map((f) => {
            const name = nameOf(f);
            return (
              <li key={sparkId({ type: f.kind, key: f.key })}>
                <span className="spark-add-name">{name}</span>
                <span className="seg-group" role="radiogroup" aria-label={`${name} stars`}>
                  {[1, 2, 3].map((n) => (
                    <button
                      key={n}
                      className={f.stars === n ? "seg active" : "seg"}
                      aria-pressed={f.stars === n}
                      onClick={() =>
                        onChange(
                          factors.map((x) =>
                            x.kind === f.kind && x.key === f.key ? { ...x, stars: n } : x
                          )
                        )
                      }
                    >
                      {n}★
                    </button>
                  ))}
                </span>
                <button
                  className="spark-drop"
                  aria-label={`Remove ${name}`}
                  onClick={() =>
                    onChange(factors.filter((x) => !(x.kind === f.kind && x.key === f.key)))
                  }
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <input
        className="spark-search"
        type="search"
        aria-label={`${label} spark search`}
        placeholder="Add a spark…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {matches.length > 0 && (
        <ul className="spark-matches">
          {matches.map((r) => (
            <li key={`${r.kind}:${r.key}`}>
              <button onClick={() => add(r)}>
                {/* The kind is part of the identity here: several race and
                    scenario sparks share wording with skills. */}
                <span className={`proc-kind proc-kind-${r.kind}`}>
                  {SPARK_TYPE_LABELS[r.kind]}
                </span>
                {r.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
