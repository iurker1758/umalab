import { useState } from "react";
import type { FactorRef, SlotFactor } from "../api";
import { SPARK_TYPE_LABELS, sparkId } from "../procs";

// Hand entry for a member's non-pink sparks. The pink editor is a fixed
// ten-aptitude select; these are 400-odd factors across four kinds and a
// member carries several, so this is a search-and-add list instead.
//
// ADDING is all it does, and adding includes the LEVEL. The held sparks used
// to be listed again below the table, each with its own ★ control — every
// non-pink spark rendered twice on one panel, in two idioms and two orders
// (#45). Removal moved into the proc row; the level moved here, onto the
// match itself.
//
// Three buttons per match rather than one (DECISIONS.md #34): you pick the
// level at the moment you are picking the spark, which is when you know it,
// and a 3★ costs one click where it used to cost two — pick, land at 1★,
// correct. It also means nothing in the table can change a chance, so no row
// can reorder under the pointer that just clicked it.
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
  const matching = q === "" ? [] : refs.filter((r) => r.name.toLowerCase().includes(q));
  const isHeld = (r: FactorRef) => held.has(sparkId({ type: r.kind, key: r.key }));
  // Held sparks are shown, marked, rather than filtered into silence. They
  // can't be added twice, but typing the right name and getting an empty box
  // reads as "no such spark" — the same "not shown vs doesn't exist"
  // distinction the cut-list hint below exists for. They don't consume the
  // eight addable slots either.
  const heldHits = matching.filter(isHeld);
  const hits = matching.filter((r) => !isHeld(r));
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
  // No default level to guess: #30 shipped a 1★ default as "the honest
  // default for one you're planning to hunt", which was the best a
  // single-click add could do. Choosing the level here retires the question.
  const add = (ref: FactorRef, stars: number) => {
    onChange([...factors, { kind: ref.kind, key: ref.key, stars }]);
    setQuery("");
  };
  return (
    <div className="spark-add">
      <input
        className="spark-search"
        type="search"
        aria-label={`${label} spark search`}
        placeholder="Add a Spark…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {(matches.length > 0 || heldHits.length > 0) && (
        <ul className="spark-matches">
          {/* First, so the answer to "why isn't it offering this" is the
              first thing under the box you typed it into. */}
          {heldHits.map((r) => (
            <li key={sparkId({ type: r.kind, key: r.key })}>
              <span className="spark-hit">
                <span className={`proc-kind proc-kind-${r.kind}`}>
                  {SPARK_TYPE_LABELS[r.kind]}
                </span>
                {r.name}
              </span>
              {/* The level it was added at lives in the table above, where
                  the ✕ that undoes it is. */}
              <span className="spark-held">Added</span>
            </li>
          ))}
          {matches.map((r) => (
            <li key={sparkId({ type: r.kind, key: r.key })}>
              <span className="spark-hit">
                {/* The kind is part of the identity here: several race and
                    scenario sparks share wording with skills. */}
                <span className={`proc-kind proc-kind-${r.kind}`}>
                  {SPARK_TYPE_LABELS[r.kind]}
                </span>
                {r.name}
              </span>
              {/* Not a `radiogroup`: these three don't hold a value between
                  them, they are three different add actions. Each names its
                  own outcome, because "3★" alone is meaningless read out of
                  the row it sits in. */}
              <span className="seg-group" role="group">
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    className="seg"
                    // The spark's identity on the button, so anything driving
                    // this list picks by id rather than by matching the
                    // displayed name — several race and scenario sparks
                    // contain a skill's name as a substring, which makes
                    // name-matching pick the wrong row.
                    data-spark={sparkId({ type: r.kind, key: r.key })}
                    data-stars={n}
                    aria-label={`Add ${r.name} at ${n}★`}
                    onClick={() => add(r, n)}
                  >
                    {n}★
                  </button>
                ))}
              </span>
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
