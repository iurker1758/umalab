import type { AptitudeLetters } from "../api";
import { APTITUDE_LABELS, aptitudeRows, bestDelta, nodeWarnings } from "../aptitude";
import { NAMED_COUNT, NODE_COUNT, genOf, nodeLabel, sparkAt, type Design } from "../blueprint";
import { gradeClass } from "../domain";

// The 31-node vertical pedigree map (Option C, mockup rev 2): a 16-column
// grid where a node spans its children's columns, generations as rows.
// Chips are terse by design — gens 0–2 name + strongest-delta badge, gens
// 3–4 the slot's single spark — with warning badges so issues surface
// without clicking; the focus panel carries the full detail.
export function TreeMap({
  design,
  selected,
  onSelect,
  charaName,
  aptitudesFor,
}: {
  design: Design;
  selected: number;
  onSelect: (i: number) => void;
  // null when the catalog fetch failed — chips then fall back to a numeric id.
  charaName: (charaId: number) => string | null;
  aptitudesFor: (cardId: number) => AptitudeLetters | null;
}) {
  const chip = (i: number, gen: number) => {
    const sel = selected === i;
    if (i < NAMED_COUNT) {
      const slot = design.named[i];
      if (slot === null) {
        return (
          <button
            className={`vnode pick${sel ? " sel" : ""}`}
            aria-label={`${nodeLabel(i)} — empty`}
            aria-pressed={sel}
            onClick={() => onSelect(i)}
          >
            + pick
          </button>
        );
      }
      const name = charaName(slot.chara_id) ?? `Chara ${slot.chara_id}`;
      const rows = aptitudeRows(design, i, aptitudesFor(slot.card_id));
      const delta = bestDelta(rows);
      const warn = nodeWarnings(design, i, aptitudesFor(slot.card_id));
      return (
        <button
          className={`vnode${sel ? " sel" : ""}`}
          aria-label={`${nodeLabel(i)} — ${name}`}
          aria-pressed={sel}
          onClick={() => onSelect(i)}
        >
          <span className="nname">{name}</span>
          {delta !== null && (
            <span className="delta">
              {APTITUDE_LABELS[delta.row.key]}{" "}
              <b className={gradeClass(delta.row.base ?? "")}>{delta.row.base}</b>
              <span className="arr">→</span>
              <b className={gradeClass(delta.row.final ?? "")}>{delta.row.final}</b>
              {delta.more > 0 && <span className="delta-more"> +{delta.more}</span>}
            </span>
          )}
          {(warn.overflow || warn.undroppable) && (
            <span className="node-warns">
              {warn.undroppable && (
                <span
                  className="node-warn red"
                  title="A typed pink here couldn't drop in game — its aptitude resolves below A"
                />
              )}
              {warn.overflow && (
                <span className="node-warn amber" title="Over 10★ of one aptitude in this node's window" />
              )}
            </span>
          )}
        </button>
      );
    }
    const spark = sparkAt(design, i);
    if (spark === null) {
      return (
        <button
          className={`vnode anon pick${sel ? " sel" : ""}`}
          aria-label={`${nodeLabel(i)} — empty`}
          aria-pressed={sel}
          onClick={() => onSelect(i)}
        >
          + spark
        </button>
      );
    }
    const label = APTITUDE_LABELS[spark.aptitude];
    return (
      <button
        className={`vnode anon${sel ? " sel" : ""}`}
        aria-label={`${nodeLabel(i)} — ${spark.stars}★ ${label}`}
        aria-pressed={sel}
        onClick={() => onSelect(i)}
      >
        {/* Gen 4's sixteen columns are too tight for one line — stack. */}
        {gen === 4 ? (
          <>
            <span className="sp">{spark.stars}★</span>
            <span className="sp-name">{label}</span>
          </>
        ) : (
          <span className="sp">
            {spark.stars}★ {label}
          </span>
        )}
      </button>
    );
  };

  const cells = [];
  for (let i = 0; i < NODE_COUNT; i++) {
    const gen = genOf(i);
    cells.push(
      <div key={i} className={`cell g${gen}`} style={{ gridColumn: `span ${16 >> gen}` }}>
        {chip(i, gen)}
      </div>
    );
  }
  return <div className="vped">{cells}</div>;
}
