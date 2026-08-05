import { useLayoutEffect, useRef, useState } from "react";
import type {
  AffinityResult,
  FactorRef,
  PinkSpark,
  SlotFactor,
} from "../api";
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
  listRows,
  memberSparks,
  sortSparks,
  sparkId,
  type SparkRef,
  type SparkSort,
} from "../procs";
import { ListFilter } from "./ListFilter";
import {
  activeSparkIds,
  chosenLists,
  toggleActive,
  union,
  type SparkListStore,
} from "../sparks";
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
}: {
  sort: SparkSort;
  onSort: (s: SparkSort) => void;
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
// keeps its spelled-out tags, where you are picking BETWEEN kinds. No control
// anywhere in the body: every table is this same two-column readout, editable
// member or not, and the edits live in the Edit Sparks popout (#41).
const SparkRow = ({
  spark,
  name,
  stars,
  watched = false,
}: {
  spark: SparkRef & { chance: number | null };
  name: string;
  // Null on the trainee's roll-up, where the row combines carriers who may
  // hold this spark at different levels — see SparkOutlook. An ancestor's own
  // table always has one, and it is what her chance is computed from.
  stars: number | null;
  // In the union of the active lists (DECISIONS.md #43). A lightness lift
  // only — hue stays with the kinds, which the tint must not compete with.
  watched?: boolean;
}) => (
  // The spark's identity on the row, so anything driving this table picks by
  // (kind, key) rather than by displayed name — the reference holds two
  // distinct whites both called "Pressure".
  <tr
    className={`proc-row proc-row-${spark.type}${watched ? " proc-row-watched" : ""}`}
    data-spark={sparkId(spark)}
  >
    <td className="proc-name">
      {stars === null ? name : <>{name} <Stars n={stars} /></>}
    </td>
    <td className="proc-chance">
      <ChanceBar type={spark.type} chance={spark.chance} />
    </td>
  </tr>
);

// The active-list selector (#67) on a panel: the Lists disclosure, pressed
// state the device-local selection every consumer reads (DECISIONS.md #43).
// Rendered ABOVE and OUTSIDE .proc-clip — nothing focusable may sit inside
// the clipped table (DECISIONS.md #34). Pressed state is the LIVE store, not
// a snapshot like the popout's: nothing in these tables is a pointer target,
// so rows may retint and refilter under the cursor safely. Nothing renders
// with no lists or a failed fetch — a control over zero lists is furniture,
// and stale pills would filter against ghosts.
function PanelListFilter({ sparkLists }: { sparkLists: SparkListStore }) {
  if (sparkLists.lists.length === 0 || sparkLists.failed) return null;
  return (
    <div className="proc-list-pills">
      <ListFilter
        lists={sparkLists.lists}
        isPressed={(id) => sparkLists.active.includes(id)}
        onToggle={(id) =>
          sparkLists.onActiveChange(toggleActive(sparkLists.active, id))
        }
      />
    </div>
  );
}

// One ancestor's own sparks: what each is worth as a contribution to the
// trainee, at this member's individual affinity (DECISIONS.md #29). The row
// shows the level beside the name; adding, re-levelling and removing all live
// in the Edit Sparks popout (#41), so nothing here can change a chance and no
// row reorders under a pointer (DECISIONS.md #34).
export function NodeProcs({
  design,
  affinity,
  index,
  sparkNames,
  factorRefs,
  sparkLists,
  cardOwner,
  locked,
  undroppable,
  sort,
  onSort,
  onSetFactors,
  onSetSpark,
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
  // The panel's below-A verdict on the held pink, forwarded into the popout:
  // the popout covers the panel's own alert, so the warning has to travel
  // with the editor.
  undroppable: boolean;
  sort: SparkSort;
  onSort: (s: SparkSort) => void;
  // An UPDATER rather than an array: two edits resolved against the same
  // render would otherwise each rebuild the list from one stale base, and the
  // later write would drop the earlier spark.
  onSetFactors: (i: number, update: (current: readonly SlotFactor[]) => SlotFactor[]) => void;
  // The same setter Details' editor writes through (#87): the popout is a
  // second writer of the slot's `spark` field, never a second store.
  onSetSpark: (i: number, spark: PinkSpark | null) => void;
  onError: (message: string) => void;
}) {
  const id = affinitySlotOf(index);
  const share = id === null || affinity === null ? null : affinity[`${id}_affinity`];
  const slot = design.named[index];
  const factors = slot?.factors ?? [];
  const memberRows = memberSparks(sparkAt(design, index), factors, share);
  // The same two states the trainee's table has (DECISIONS.md #43): a
  // selection narrows to the chosen lists' sparks — "—" for one she doesn't
  // carry — and nothing selected shows her own rows with the listed ones
  // tinted. Her held sparks stay held either way; the filter is a view.
  const chosen = chosenLists(sparkLists.lists, sparkLists.active);
  const filtered = chosen.length > 0;
  const rows = sortSparks(
    filtered ? listRows(memberRows, union(chosen)) : memberRows,
    sort
  );
  const watched = filtered ? null : activeSparkIds(sparkLists.lists, sparkLists.active);
  return (
    <>
      <PanelListFilter sparkLists={sparkLists} />
      <table className="proc-table">
        {/* A pulled ancestor's table sorts too; she just gains no editing
            control, which is what DECISIONS.md #28 makes read-only — and an
            editable member's table renders identically to hers, the popout
            below being the only difference (#41). */}
        <SparkHead sort={sort} onSort={onSort} />
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="proc-name proc-empty" colSpan={2}>
                {filtered
                  ? "Nothing in the selected lists yet."
                  : "No sparks on this member yet."}
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <SparkRow
                key={sparkId(r)}
                spark={r}
                name={sparkName(r, sparkNames)}
                stars={"stars" in r ? r.stars : null}
                watched={watched !== null && watched.has(sparkId(r))}
              />
            ))
          )}
        </tbody>
      </table>
      {/* The pink's home editor stays on the Details tab, beside the letters
          it bumps at career start; the popout is its second entry point
          (#87), so shaping a proc profile never forces a tab switch. A
          locked node offers no entry at all (#28). */}
      {!locked && (
        <SparkChooser
          // Remounted per node: the open state and the query are component
          // state, and the panel keeps its position in the tree when you click
          // another ancestor — so an abandoned query would follow you there
          // and add to the wrong member.
          key={index}
          label={NAMED_SHORT[index]}
          factors={factors}
          spark={sparkAt(design, index)}
          refs={factorRefs}
          sparkLists={sparkLists}
          // Which greens this node can hold at all. A green's key is a
          // card_id, so a cast node has exactly one and offering the other
          // 136 offers sparks she can never carry.
          cardId={slot?.card_id ?? null}
          charaId={slot?.chara_id ?? null}
          cardOwner={cardOwner}
          undroppable={undroppable}
          onChange={(update) => onSetFactors(index, update)}
          onSetSpark={(s) => onSetSpark(index, s)}
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
//
// The active selection filters it (DECISIONS.md #43). Nothing selected keeps
// the ranked table answering "what will I get", with the union of ALL lists
// tinted; lists selected swaps the rows for the union of the SELECTED lists —
// "what am I hunting" — where a spark no ancestor carries renders the "—" a
// chance that can't be estimated already does. Same table either way, so the
// clip, the sort and the fold never learn the filter exists.
export function TraineeProcs({
  design,
  affinity,
  sparkNames,
  sparkLists,
  sort,
  onSort,
}: {
  design: Design;
  affinity: AffinityResult | null;
  sparkNames: Map<string, string>;
  sparkLists: SparkListStore;
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
  const chosen = chosenLists(sparkLists.lists, sparkLists.active);
  const filtered = chosen.length > 0;
  const rows = filtered ? listRows(outlooks, union(chosen)) : outlooks;
  // Tint only while unfiltered: filtered, every row is selected by
  // construction, and tinting all of them says nothing.
  const watched = filtered ? null : activeSparkIds(sparkLists.lists, sparkLists.active);
  // Measured against the table's own height rather than the wrapper's, so the
  // answer doesn't depend on whether the clip is currently applied. The
  // observer catches the sort changing a row's wrap, the viewport changing,
  // and a spark being typed on an ancestor while this tab is open. `rows`,
  // not `outlooks`: the observer misses the element being REPLACED across the
  // early-return boundary, and the filter can swap row sets of equal outlook
  // count.
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
  }, [rows.length]);
  // Only the UNFILTERED empty tree gets the note: a selection over an empty
  // tree falls through to the table, all rows "—" — which while planning is
  // the answer, not a degenerate case.
  if (!filtered && outlooks.length === 0) {
    return (
      <>
        <PanelListFilter sparkLists={sparkLists} />
        <p className="focus-note">No sparks on the ancestors yet.</p>
      </>
    );
  }
  const shown = sortSparks(rows, sort);
  const clipped = tall && !expanded;
  return (
    <>
      <PanelListFilter sparkLists={sparkLists} />
      <div className={clipped ? "proc-clip proc-clipped" : "proc-clip"}>
        <table ref={tableRef} className="proc-table">
          <SparkHead sort={sort} onSort={onSort} />
          <tbody>
            {/* Which members carry each spark is deliberately not a column: this
                table answers "what am I likely to come out with", and the
                per-member breakdown is one click away on their own tabs. */}
            {shown.length === 0 ? (
              <tr>
                <td className="proc-name proc-empty" colSpan={2}>
                  Nothing in the selected lists yet.
                </td>
              </tr>
            ) : (
              shown.map((o) => (
                <SparkRow
                  key={sparkId(o)}
                  spark={o}
                  name={sparkName(o, sparkNames)}
                  // No level on this table: the carriers may hold a spark at
                  // different levels, and the chance is the union across them.
                  stars={null}
                  watched={watched !== null && watched.has(sparkId(o))}
                />
              ))
            )}
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
          {expanded ? "Show Fewer" : `Show All ${rows.length}`}
        </button>
      )}
    </>
  );
}
