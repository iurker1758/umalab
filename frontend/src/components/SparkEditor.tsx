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

// How many matches the search offers at once. Short on purpose: it is a
// "which of these did you mean" list, not a browser.
const MATCH_LIMIT = 8;

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
  const held = new Set(factors.map((f) => sparkId({ type: f.kind, key: f.key })));
  const q = query.trim().toLowerCase();
  // Only search once there's something to search for: 400 rows under every
  // ancestor panel is a list nobody reads, and the control is an "add one"
  // affordance rather than a browser.
  const hits =
    q === ""
      ? []
      : refs.filter(
          (r) => !held.has(sparkId({ type: r.kind, key: r.key })) && r.name.toLowerCase().includes(q)
        );
  // Ranked by where the query lands in the name, then alphabetically —
  // deliberately NOT in the order the reference arrives. That order is
  // (kind, name), so capping it directly returned eight race sparks and hid
  // every white match behind them: a systematic bias against the kind people
  // search for most, with nothing on screen to say so.
  hits.sort((a, b) => {
    const ai = a.name.toLowerCase().indexOf(q);
    const bi = b.name.toLowerCase().indexOf(q);
    return ai - bi || a.name.localeCompare(b.name);
  });
  const matches = hits.slice(0, MATCH_LIMIT);
  const hidden = hits.length - matches.length;
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
        placeholder="Add a Spark…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {matches.length > 0 && (
        <ul className="spark-matches">
          {matches.map((r) => (
            <li key={sparkId({ type: r.kind, key: r.key })}>
              {/* The spark's identity on the button, so anything driving this
                  list picks by id rather than by matching the displayed name
                  — several race and scenario sparks contain a skill's name as
                  a substring, which makes name-matching pick the wrong row. */}
              <button data-spark={sparkId({ type: r.kind, key: r.key })} onClick={() => add(r)}>
                {/* The kind is part of the identity here: several race and
                    scenario sparks share wording with skills. */}
                <span className={`proc-kind proc-kind-${r.kind}`}>
                  {SPARK_TYPE_LABELS[r.kind]}
                </span>
                {r.name}
              </button>
            </li>
          ))}
          {/* Said when it applies, so a cut list never reads as an exhausted
              one — the difference between "no such spark" and "not shown". */}
          {hidden > 0 && (
            <li className="spark-more">{hidden} more — keep typing to narrow.</li>
          )}
        </ul>
      )}
    </div>
  );
}
