import { useLayoutEffect, useRef, useState } from "react";
import type {
  AffinityResult,
  FactorRef,
  SlotFactor,
  SlotFactorKind,
} from "../api";
import type { SparkListStore } from "../sparks";
import { APTITUDE_LABELS } from "../aptitude";
import {
  NAMED_COUNT,
  NAMED_SHORT,
  affinitySlotOf,
  sparkAt,
  type Design,
} from "../blueprint";
import {
  combineOutlooks,
  formatChance,
  memberSparks,
  sortSparks,
  sparkId,
  type SparkRef,
  type SparkSort,
} from "../procs";
import { SparkChooser } from "./SparkChooser";

// The Sparks tab. Every spark in the tree is here as a chance the TRAINEE
// comes out with it — which is what an inspiration proc off an ancestor is.
// See procs.ts for the model and why every number is an estimate.

// Everything but the pink is resolved from the committed reference at render
// time rather than stored with the design: names are localized strings and the
// factor key is the identity. A key the reference doesn't know degrades to the
// same "Unknown (key)" the decoder uses, instead of rendering blank.
function sparkName(ref: SparkRef, names: Map<string, string>): string {
  return ref.type === "pink"
    ? APTITUDE_LABELS[ref.aptitude]
    : (names.get(sparkId(ref)) ?? `Unknown (${ref.key})`);
}

// Named, not just drawn: a run of ★ reads as "black star black star black
// star" and says nothing about what it counts.
const Stars = ({ n }: { n: number }) => (
  <span className="proc-stars" role="img" aria-label={`${n} star${n === 1 ? "" : "s"}`}>
    {"★".repeat(n)}
  </span>
);

// Scaled 0–100 absolutely, not to the table's own maximum: a relative scale
// would draw a full bar for a 3% spark whenever nothing else beats it, and
// "unlikely" is exactly what this table exists to tell you. The realistic
// range uses the space — a 3★ green on a well-matched parent runs past 80%, a
// 1★ race sits near 3%.
const ChanceBar = ({ type, chance }: { type: SparkRef["type"]; chance: number | null }) =>
  chance === null ? (
    <span className="proc-none">—</span>
  ) : (
    <div className="proc-bar">
      <div className={`proc-fill proc-fill-${type}`} style={{ width: `${chance}%` }} />
      <span className="proc-pct">{formatChance(chance)}</span>
    </div>
  );

// The header row, which is also the sort control (DECISIONS.md #34). The two
// orders land on the columns that carry them — kind is what the Spark column's
// colour says, chance is the Est. Per Run column itself — so the tab needs no
// second segmented control competing with the map for panel height.
//
// The caret is a CSS `::after` on the active header rather than text, so the
// labels stay exactly "Spark" and "Est. Per Run" in the DOM and `aria-sort`
// announces the state. Real buttons inside the `th`, not a click handler on
// the cell, so the headers are reachable by keyboard.
//
// "est." because the rates were never datamined, "per run" because this is the
// chance over the career's two compatibility-dependent inheritance events, not
// the chance at any one of them.
const SparkHead = ({
  sort,
  onSort,
  level,
}: {
  sort: SparkSort;
  onSort: (s: SparkSort) => void;
  // Whether the table carries the ★ column, which never sorts anything.
  level: boolean;
}) => (
  <thead>
    <tr>
      {/* `other` rather than `ascending`: grouping by kind is a fixed
          five-way order, not a direction, and the spec has a value for
          exactly that. */}
      <th
        scope="col"
        className="proc-name proc-th-sort"
        aria-sort={sort === "kind" ? "other" : "none"}
      >
        <button className="proc-h" title="Group by kind" onClick={() => onSort("kind")}>
          Spark
        </button>
      </th>
      {/* Blank on screen — the glyphs under it already say what it is — but
          named for anyone who reaches the cell through its column header. */}
      {level && <th scope="col" className="proc-level" aria-label="Stars" />}
      {/* The tooltip sits on the cell, so the sort button inside doesn't need
          one of its own competing with it. */}
      <th
        scope="col"
        className="proc-chance proc-th-sort"
        aria-sort={sort === "chance" ? "descending" : "none"}
        title="Estimated, not datamined — chance over the run's two inheritance events"
      >
        <button className="proc-h" onClick={() => onSort("chance")}>
          Est. Per Run
        </button>
      </th>
    </tr>
  </thead>
);

// One row: the spark named in its kind's colour, and the chance beside it in a
// bar filled to match. The kind is carried by colour alone here — the chooser
// keeps its spelled-out tags, where you are picking BETWEEN kinds.
const SparkRow = ({
  spark,
  name,
  stars,
  level,
}: {
  spark: SparkRef & { chance: number | null };
  name: string;
  // Null on the trainee's roll-up, where the row combines carriers who may
  // hold this spark at different levels — see SparkOutlook. An ancestor's own
  // table always has one, and it is what her chance is computed from.
  stars: number | null;
  // Null on tables with no level column: the trainee's roll-up and a pulled
  // ancestor's, both two-column readouts. `onRemove` null is the pink, whose
  // editor is on Details beside the letters it bumps — so she differs by
  // lacking a ✕, not by lacking a control the other rows have.
  level: null | { onRemove: (() => void) | null };
}) => (
  // The spark's identity on the row, so anything driving this table picks by
  // (kind, key) rather than by displayed name — the reference holds two
  // distinct whites both called "Pressure".
  <tr className={`proc-row proc-row-${spark.type}`} data-spark={sparkId(spark)}>
    <td className="proc-name">
      {/* The glyphs move into the level column when there is one, rather than
          being printed twice. */}
      {stars === null || level !== null ? name : <>{name} <Stars n={stars} /></>}
    </td>
    {level !== null && (
      <td className="proc-level">
        {stars !== null && <Stars n={stars} />}
        {/* The slot is held on the pink's row too, empty: without it her ★ run
            to the cell edge while every other row's stop short of a ✕, and a
            column of stars that doesn't line up reads as a rendering fault
            rather than as one row being read-only. */}
        {level.onRemove === null ? (
          <span className="proc-drop-blank" />
        ) : (
          <button className="proc-drop" aria-label={`Remove ${name}`} onClick={level.onRemove}>
            ×
          </button>
        )}
      </td>
    )}
    <td className="proc-chance">
      <ChanceBar type={spark.type} chance={spark.chance} />
    </td>
  </tr>
);

// One ancestor's own sparks: what each is worth as a contribution to the
// trainee, at this member's individual affinity (DECISIONS.md #29). The row
// shows the level and can drop the spark; the level itself is chosen when the
// spark is added, so nothing here can change a chance and no row reorders
// under a pointer (DECISIONS.md #34).
export function NodeProcs({
  design,
  affinity,
  index,
  sparkNames,
  factorRefs,
  sparkLists,
  cardOwner,
  locked,
  sort,
  onSort,
  onSetFactors,
  onError,
}: {
  design: Design;
  affinity: AffinityResult | null;
  index: number;
  sparkNames: Map<string, string>;
  factorRefs: FactorRef[];
  sparkLists: SparkListStore;
  // Names the uma a green spark belongs to — its factor key IS a card_id.
  cardOwner: (cardId: number) => string | null;
  // Inside a pulled branch: these sparks are the horse's own, read off her
  // dump, so they are shown rather than edited — the same rule her pink
  // follows.
  locked: boolean;
  sort: SparkSort;
  onSort: (s: SparkSort) => void;
  // An UPDATER rather than an array: two edits resolved against the same
  // render would otherwise each rebuild the list from one stale base, and the
  // later write would drop the earlier spark.
  onSetFactors: (i: number, update: (current: readonly SlotFactor[]) => SlotFactor[]) => void;
  onError: (message: string) => void;
}) {
  const id = affinitySlotOf(index);
  const share = id === null || affinity === null ? null : affinity[`${id}_affinity`];
  const slot = design.named[index];
  const factors = slot?.factors ?? [];
  const rows = sortSparks(memberSparks(sparkAt(design, index), factors, share), sort);
  const drop = (kind: SlotFactorKind, key: number) =>
    onSetFactors(index, (current) =>
      current.filter((x) => !(x.kind === kind && x.key === key))
    );
  return (
    <>
      {/* The modifier buys the level column its width back off the chance
          column, and ONLY here: a locked table and the trainee's roll-up keep
          the width #30 measured. */}
      <table className={locked ? "proc-table" : "proc-table proc-table-edit"}>
        {/* A pulled ancestor's table sorts too; she just gains no editing
            control, which is what DECISIONS.md #28 makes read-only. */}
        <SparkHead sort={sort} onSort={onSort} level={!locked} />
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="proc-name proc-empty" colSpan={locked ? 2 : 3}>
                No sparks on this member yet.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <SparkRow
                key={sparkId(r)}
                spark={r}
                name={sparkName(r, sparkNames)}
                stars={r.stars}
                level={
                  locked
                    ? null
                    : { onRemove: r.type === "pink" ? null : () => drop(r.type, r.key) }
                }
              />
            ))
          )}
        </tbody>
      </table>
      {/* The pink is edited on the Details tab, beside the letters it bumps at
          career start; these feed nothing but these numbers, so they are
          entered here. A locked node offers no entry at all (#28). */}
      {!locked && (
        <SparkChooser
          // Remounted per node: the open state and the query are component
          // state, and the panel keeps its position in the tree when you click
          // another ancestor — so an abandoned query would follow you there
          // and add to the wrong member.
          key={index}
          label={NAMED_SHORT[index]}
          factors={factors}
          refs={factorRefs}
          sparkLists={sparkLists}
          // Which greens this node can hold at all. A green's key is a
          // card_id, so a cast node has exactly one and offering the other
          // 136 offers sparks she can never carry.
          cardId={slot?.card_id ?? null}
          charaId={slot?.chara_id ?? null}
          cardOwner={cardOwner}
          onChange={(update) => onSetFactors(index, update)}
          onError={onError}
        />
      )}
    </>
  );
}

// How tall the trainee's roll-up gets before it is clipped. A fully bred tree
// runs to about 34 distinct sparks, a panel 1.2× the viewport; the clip keeps
// the tab close to Details in height, so switching between them doesn't reflow
// the page under you.
//
// A HEIGHT, not a row count (DECISIONS.md #34). Every row is rendered in
// whatever order the sort put them, so the sort and the fold don't interact.
// The clip cuts wherever the layout falls and says so — the last row is sliced
// through and faded rather than ending on a clean edge that reads as a
// finished list.
//
// The height lives in ONE place, `--proc-clip` on `.proc-clip`, and is read
// back from there. Written twice, the two drift silently: lower the CSS alone
// and rows hide with no button to reveal them; lower this alone and the button
// offers to reveal nothing.
const clipHeight = (el: Element): number => {
  const raw = getComputedStyle(el).getPropertyValue("--proc-clip").trim();
  const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return raw.endsWith("rem") ? parseFloat(raw) * root : parseFloat(raw);
};

// The trainee's roll-up: one row per distinct spark in the tree, at the chance
// ANY of its carriers lands it. Two members holding the same skill is how you
// actually hunt one, so the combined number is the question no single
// ancestor's tab can answer.
export function TraineeProcs({
  design,
  affinity,
  sparkNames,
  sort,
  onSort,
}: {
  design: Design;
  affinity: AffinityResult | null;
  sparkNames: Map<string, string>;
  sort: SparkSort;
  onSort: (s: SparkSort) => void;
}) {
  // Resets when you leave the trainee, which is the right scope: it is a
  // "show me the tail of THIS list" answer, not a preference.
  const [expanded, setExpanded] = useState(false);
  // Whether the table is taller than the clip — measured, not counted, since
  // the clip is a height and a row's height depends on whether its name
  // wrapped. It decides both the fade and whether the button exists at all: a
  // list that fits must not offer to reveal nothing.
  const [tall, setTall] = useState(false);
  const tableRef = useRef<HTMLTableElement>(null);
  const perMember = [];
  for (let i = 1; i < NAMED_COUNT; i++) {
    const id = affinitySlotOf(i);
    const share = id === null || affinity === null ? null : affinity[`${id}_affinity`];
    const slot = design.named[i];
    const sparks = memberSparks(sparkAt(design, i), slot?.factors ?? [], share);
    if (sparks.length > 0) perMember.push({ index: i, sparks });
  }
  const outlooks = combineOutlooks(perMember);
  // Measured against the table's own height rather than the wrapper's, so the
  // answer doesn't depend on whether the clip is currently applied. The
  // observer catches the sort changing a row's wrap, the viewport changing,
  // and a spark being typed on an ancestor while this tab is open.
  useLayoutEffect(() => {
    const el = tableRef.current;
    if (el === null) return;
    const measure = () => {
      // The custom property inherits, so the table reads the wrapper's value.
      const tallNow = el.getBoundingClientRect().height > clipHeight(el) + 1;
      setTall(tallNow);
      // Expanding answers "show me the rest of THIS list", so it dies with the
      // list that prompted it: a table that shrinks under the clip while open
      // would otherwise leave `expanded` true and never re-apply the fold when
      // it grew back.
      if (!tallNow) setExpanded(false);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [outlooks.length]);
  if (outlooks.length === 0) {
    return <p className="focus-note">No sparks on the ancestors yet.</p>;
  }
  const shown = sortSparks(outlooks, sort);
  const clipped = tall && !expanded;
  return (
    <>
      <div className={clipped ? "proc-clip proc-clipped" : "proc-clip"}>
        <table ref={tableRef} className="proc-table">
          <SparkHead sort={sort} onSort={onSort} level={false} />
          <tbody>
            {/* Which members carry each spark is deliberately not a column: this
                table answers "what am I likely to come out with", and the
                per-member breakdown is one click away on their own tabs. */}
            {shown.map((o) => (
              <SparkRow
                key={sparkId(o)}
                spark={o}
                name={sparkName(o, sparkNames)}
                stars={null}
                // No level column: this table has no level to show (the
                // carriers may differ) and nothing here is edited.
                level={null}
              />
            ))}
          </tbody>
        </table>
      </div>
      {/* The count is the point of the label: "34" says how much tree there is
          below the fold, which a bare "Show More" wouldn't. */}
      {tall && (
        <button
          className="proc-more"
          // The rows below the fold are in the DOM, so the button is a
          // disclosure rather than a loader — it has to say which state it is
          // in for anyone who can't see the fade.
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show Fewer" : `Show All ${outlooks.length}`}
        </button>
      )}
    </>
  );
}
