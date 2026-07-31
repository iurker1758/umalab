import type { AptitudeKey, AptitudeLetters } from "../api";
import {
  APTITUDE_GROUPS,
  APTITUDE_LABELS,
  aptitudeRows,
  letterModeOf,
  undroppableSpark,
  type AptitudeRow,
} from "../aptitude";
import {
  NAMED_COUNT,
  NODE_COUNT,
  deepCardAt,
  deriveCharaId,
  genOf,
  nodeLabel,
  sparkAt,
  type Design,
} from "../blueprint";
import { gradeClass, isCharaPlaceholder } from "../domain";

// The 31-node vertical pedigree map (Option C, mockup rev 2): a 16-column
// grid where a node spans its children's columns, generations as rows.
// Named cards carry the full letter grid; gens 3–4 are single sparks —
// with warning badges so issues surface without clicking, and the focus
// panel for the cause math.
export function TreeMap({
  design,
  selected,
  onSelect,
  charaName,
  aptitudesFor,
  iconIndex,
  side = null,
}: {
  design: Design;
  selected: number;
  onSelect: (i: number) => void;
  // null when the catalog fetch failed — chips then fall back to a numeric id.
  charaName: (charaId: number) => string | null;
  aptitudesFor: (cardId: number) => AptitudeLetters | null;
  iconIndex: Record<string, string>;
  // Narrow screens view one parent's half at a time (node 1 or 2): sixteen
  // gen-4 columns can't be read on a phone. null ⇒ the whole tree.
  side?: number | null;
}) {
  // "Out of 3" star readout, matching the roster cards' filled/unfilled
  // convention; the pink comes from the surrounding context's CSS.
  const starTrio = (n: number) => (
    <span className="spark-stars">
      {[1, 2, 3].map((s) => (
        <span key={s} className={`star${s <= n ? " filled" : ""}`}>
          ★
        </span>
      ))}
    </span>
  );

  // A deep slot's portrait, at the same scale in every state so the spark row
  // below never shifts. Falls back exactly as the named nodes do: the
  // character's initial when a pull named the slot but the art isn't on disk
  // (it's gitignored — DECISIONS.md #10), and "+" on a slot nothing has
  // filled yet.
  // The letter to stand in for a missing portrait, given who the slot holds.
  // "+" only when nobody is in it — a slot with a character is never drawn as
  // an empty one. Blank while the catalog is still in flight, so the space
  // stays reserved and no letter flashes before the real one. "?" for a chara
  // the catalog doesn't know: an initial off "Chara 1006" would render an
  // identical "C" for every one of them, the opposite of the recognition the
  // stored id exists to provide.
  const initial = (card: number | null, name: string | null): string =>
    card === null ? "+" : name === null ? "" : isCharaPlaceholder(name) ? "?" : name.charAt(0);

  const deepIcon = (card: number | null) => {
    const icon = card === null ? undefined : iconIndex[String(card)];
    if (icon !== undefined) {
      return <img className="sp-ico" src={`/icons/chara/${icon}`} alt="" loading="lazy" />;
    }
    const name = card === null ? null : charaName(deriveCharaId(card));
    return (
      <span className="lineage-icon-fallback sp-ico" aria-hidden="true">
        {initial(card, name)}
      </span>
    );
  };

  const chip = (i: number, gen: number) => {
    const sel = selected === i;
    if (i < NAMED_COUNT) {
      const slot = design.named[i];
      // "Empty" here means no CHARACTER: a node can carry a planned spark
      // with nobody cast in it yet, and then it reads like an empty card
      // with a pink row. Empty cards keep the full footprint with "-"
      // letters (the u-ma.org convention) so the tree's geometry never
      // jumps as picks land, and every slot advertises what it will show.
      const card = slot?.card_id ?? null;
      const chara = slot?.chara_id ?? null;
      const empty = card === null || chara === null;
      const spark = sparkAt(design, i);
      // One generic placeholder for every empty card — role names vary too
      // much in length ("Grandparent 2-1" ellipsizes at the g2 width); the
      // role stays on the tooltip and in the aria-label.
      // Null while the catalog is still in flight — the band below holds its
      // space blank rather than showing a placeholder that's about to change.
      const name = chara === null ? null : charaName(chara);
      const icon = empty ? undefined : iconIndex[String(card)];
      // Three modes, one per source — see LetterMode. A catalog pick
      // projects, a roster pick reports what she trained to, a pulled
      // lineage member states her card and no more.
      const rows = empty
        ? []
        : aptitudeRows(
            design,
            i,
            aptitudesFor(card),
            letterModeOf(slot),
            slot?.aptitudes ?? null
          );
      const byKey = new Map<AptitudeKey, AptitudeRow>(rows.map((r) => [r.key, r]));
      // Takes the rows already in hand — the window scan and bracket math
      // behind them are the expensive part, and this runs for every named
      // node on every render.
      const warn = empty ? false : undroppableSpark(rows, design, i);
      const cell = (k: AptitudeKey) => {
        const r = byKey.get(k);
        // "-" also covers a filled card whose letters are unknown.
        const final = r?.final ?? null;
        return (
          <span
            key={k}
            className="apt-cell"
            title={
              final === null
                ? APTITUDE_LABELS[k]
                : `${APTITUDE_LABELS[k]}: ${
                    r?.boosted ? `${r.base ?? "?"} → ${final}` : final
                  }`
            }
          >
            <span className="apt-cell-tag">{APTITUDE_LABELS[k]}</span>
            {final === null ? (
              <b className="blank">-</b>
            ) : (
              <b className={`${gradeClass(final)}${r?.boosted ? " boosted" : ""}`}>{final}</b>
            )}
          </span>
        );
      };
      const [, trackKeys] = APTITUDE_GROUPS[0];
      const [, distanceKeys] = APTITUDE_GROUPS[1];
      const [, styleKeys] = APTITUDE_GROUPS[2];
      return (
        <button
          className={`vnode named${empty ? " pick" : ""}${sel ? " sel" : ""}`}
          // Keyed off whether a character is CAST, not off whether its name
          // has arrived: a cast node whose catalog entry is still loading
          // must not read as an empty one.
          aria-label={`${nodeLabel(i)} — ${
            chara !== null
              ? (name ?? "…")
              : spark === null
                ? "empty"
                : `${spark.stars}★ ${APTITUDE_LABELS[spark.aptitude]}`
          }`}
          title={empty ? nodeLabel(i) : undefined}
          aria-pressed={sel}
          onClick={() => onSelect(i)}
        >
          {/* Roster-style grouped rows (the u-ma.org labeled-node idea):
              icon + track, then distance, then style, then the typed
              pink, with the name footing the card at full width. The
              trainee never carries a spark row. */}
          <span className="head">
            {icon ? (
              <img src={`/icons/chara/${icon}`} alt="" loading="lazy" />
            ) : (
              <span className="lineage-icon-fallback">{initial(chara === null ? null : card, name)}</span>
            )}
            {trackKeys.map(cell)}
          </span>
          <span className="apt-row">{distanceKeys.map(cell)}</span>
          <span className="apt-row">{styleKeys.map(cell)}</span>
          {i > 0 &&
            (spark !== null ? (
              // The one thing worth a tooltip here is the undroppable
              // pink; the warn background is what advertises it, so the
              // row never carries hidden text you'd have to hunt for.
              <span
                className={`spark-row${warn ? " warn" : ""}`}
                title={
                  warn
                    ? `${APTITUDE_LABELS[spark.aptitude]} resolves below A — pinks only drop at A.`
                    : undefined
                }
              >
                {APTITUDE_LABELS[spark.aptitude]} {starTrio(spark.stars)}
              </span>
            ) : (
              // Same shape as a filled row — "Aptitude" placeholder, all
              // three stars unfilled — so the row never changes footprint.
              <span className="spark-row none">Aptitude {starTrio(0)}</span>
            ))}
          {/* Empty cards keep the band, unlabeled — the footprint holds
              without a placeholder word competing with real names. */}
          <span className="nname">{name ?? " "}</span>
          {warn && (
            <span className="node-warns">
              <span
                className="node-warn red"
                title="A typed pink here couldn't drop in game — its aptitude resolves below A"
              />
            </span>
          )}
        </button>
      );
    }
    // A deep slot holds a pink, a character, or both — like the named nodes
    // above, where a character can be cast before its pink is decided.
    const spark = sparkAt(design, i);
    const card = deepCardAt(design, i);
    if (spark === null) {
      // The named cards' row-4 placeholder, at slot scale: "Aptitude" over
      // three unfilled stars — a slot with no pink keeps the filled
      // footprint. Only one with nobody in it either reads as empty.
      const who = card === null ? null : charaName(deriveCharaId(card));
      return (
        <button
          className={`vnode anon${card === null ? " pick" : ""}${sel ? " sel" : ""}`}
          // Keyed off the card, not the name: a slot with somebody in it
          // whose name hasn't loaded yet is not empty.
          aria-label={`${nodeLabel(i)} — ${card === null ? "empty" : (who ?? "…")}`}
          aria-pressed={sel}
          onClick={() => onSelect(i)}
        >
          {deepIcon(card)}
          {/* `ph` de-emphasises the placeholder wording. On an empty slot
              .vnode.pick already does that; a slot with a face in it isn't
              empty and mustn't take pick's dashed border, so it carries the
              de-emphasis here instead — otherwise "Aptitude ☆☆☆" renders in
              the filled-pink weight and reads as a spark by that name. */}
          {gen === 4 ? (
            <>
              {starTrio(0)}
              <span className="sp-name ph">Aptitude</span>
            </>
          ) : (
            <span className="sp ph">Aptitude {starTrio(0)}</span>
          )}
        </button>
      );
    }
    const label = APTITUDE_LABELS[spark.aptitude];
    const who = card === null ? null : charaName(deriveCharaId(card));
    // Deep slots are anonymous by name — there's no room for one down here —
    // but the portrait is what makes them recognisable at a glance. The art
    // itself stays decorative: whoever the slot holds is named in the label
    // instead, so nothing depends on the icons being on disk. The empty-pink
    // branch above names the character too — a node mustn't change what it
    // announces just because a spark happens to be present.
    return (
      <button
        className={`vnode anon${sel ? " sel" : ""}`}
        aria-label={`${nodeLabel(i)} — ${spark.stars}★ ${label}${
          card === null ? "" : ` · ${who ?? "…"}`
        }`}
        aria-pressed={sel}
        onClick={() => onSelect(i)}
      >
        {deepIcon(card)}
        {/* Gen 4's sixteen columns are too tight for one line — stack. */}
        {gen === 4 ? (
          <>
            {starTrio(spark.stars)}
            <span className="sp-name">{label}</span>
          </>
        ) : (
          <span className="sp">
            {label} {starTrio(spark.stars)}
          </span>
        )}
      </button>
    );
  };

  const cells = [];
  // Connectors are drawn per cell (see styles.css): a stub up to the mid-gap
  // rail, then half a rail toward the sibling — odd indices are left kids,
  // even ones right kids, so the two halves meet exactly under the parent's
  // centre. `solo` is the half-tree's top parent, which has no sibling on
  // screen and so needs no rail at all.
  const cell = (i: number, span: number, solo = false) => {
    const gen = genOf(i);
    const kid = i === 0 ? "" : i % 2 === 1 ? " kid-l" : " kid-r";
    return (
      <div
        key={i}
        className={`cell g${gen}${solo ? " solo" : kid}`}
        style={{ gridColumn: `span ${span}` }}
      >
        {chip(i, gen)}
      </div>
    );
  };
  if (side === null) {
    for (let i = 0; i < NODE_COUNT; i++) cells.push(cell(i, 16 >> genOf(i)));
  } else {
    // Half tree over 8 columns: the trainee, then the chosen parent and
    // everything under it. A subtree root r's descendants at depth d start
    // at (r+1)·2^d − 1 and run 2^d wide — the same halving the full grid
    // does, one branch narrower.
    cells.push(cell(0, 8));
    for (let d = 0; d <= 3; d++) {
      const start = (side + 1) * (1 << d) - 1;
      for (let k = 0; k < 1 << d; k++) cells.push(cell(start + k, 8 >> d, d === 0));
    }
  }
  return <div className={`vped${side === null ? "" : " half"}`}>{cells}</div>;
}
