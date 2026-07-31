import type { AptitudeLetters, PinkSpark } from "../api";
import { APTITUDE_LABELS, aptitudeRows, undroppableSpark } from "../aptitude";
import {
  NAMED_COUNT,
  genOf,
  kidsOf,
  nodeLabel,
  parentOf,
  sparkAt,
  type Design,
} from "../blueprint";
import { AptitudeTable } from "./AptitudeTable";
import { PinkSparkEditor } from "./PinkSparkEditor";

const BRACKET_LEGEND = "1–3★ +1 · 4–6★ +2 · 7–9★ +3 · 10★ +4 · cap A";

// The docked focus panel (Option C): everything about the selected node —
// read and edit — lives here, so the map never needs popovers.
export function FocusPanel({
  design,
  index,
  iconIndex,
  charaName,
  outfitFor,
  aptitudesFor,
  onSelect,
  onOpenPicker,
  onClear,
  onSetSpark,
}: {
  design: Design;
  index: number;
  iconIndex: Record<string, string>;
  charaName: (charaId: number) => string | null;
  outfitFor: (cardId: number) => string | null;
  aptitudesFor: (cardId: number) => AptitudeLetters | null;
  onSelect: (i: number) => void;
  onOpenPicker: (i: number) => void;
  onClear: (i: number) => void;
  onSetSpark: (i: number, spark: PinkSpark | null) => void;
}) {
  const gen = genOf(index);

  // The named ancestors whose career-start brackets count this slot's spark:
  // its parent and grandparent in the tree, when they're identity nodes.
  const feeds = [parentOf(index), parentOf(parentOf(index))]
    .filter((a) => a >= 0 && a < NAMED_COUNT)
    .map((a) => {
      const slot = design.named[a];
      const name = slot === null ? null : charaName(slot.chara_id);
      return name === null ? nodeLabel(a) : `${nodeLabel(a)} (${name})`;
    });

  // Rows for the node's breeding parents — one hop down the tree, named or
  // anonymous — doubling as quick navigation.
  const kidRows = (i: number) =>
    kidsOf(i).map((k) => {
      if (k < NAMED_COUNT) {
        const slot = design.named[k];
        if (slot === null) {
          return (
            <button key={k} className="focus-row dashed" onClick={() => onSelect(k)}>
              + pick {nodeLabel(k)}
            </button>
          );
        }
        const name = charaName(slot.chara_id) ?? `Chara ${slot.chara_id}`;
        const icon = iconIndex[String(slot.card_id)];
        return (
          <button key={k} className="focus-row" onClick={() => onSelect(k)}>
            {icon ? (
              <img src={`/icons/chara/${icon}`} alt="" loading="lazy" />
            ) : (
              <span className="lineage-icon-fallback">{name.charAt(0)}</span>
            )}
            <span className="focus-row-name">{name}</span>
            {slot.spark !== null && (
              <span className="focus-row-spark">
                {slot.spark.stars}★ {APTITUDE_LABELS[slot.spark.aptitude]}
              </span>
            )}
          </button>
        );
      }
      const spark = sparkAt(design, k);
      return (
        <button key={k} className={`focus-row${spark === null ? " dashed" : ""}`} onClick={() => onSelect(k)}>
          {spark === null ? (
            <>+ spark ({nodeLabel(k)})</>
          ) : (
            <span className="focus-row-spark">
              {spark.stars}★ {APTITUDE_LABELS[spark.aptitude]}
            </span>
          )}
        </button>
      );
    });

  // ---------- anonymous spark slot ----------
  if (index >= NAMED_COUNT) {
    return (
      <div className="focus">
        <div className="focus-who">
          <div>
            <div className="focus-name">{nodeLabel(index)}</div>
            <div className="focus-role">generation {gen} ancestor · spark only, no identity</div>
          </div>
        </div>
        <h4>Pink spark</h4>
        <PinkSparkEditor
          label={nodeLabel(index)}
          spark={sparkAt(design, index)}
          onChange={(s) => onSetSpark(index, s)}
        />
        <h4>Feeds into</h4>
        <p className="focus-note">
          Counted in the career-start brackets of {feeds.join(" and ")}.
        </p>
        <p className="focus-legend">{BRACKET_LEGEND}</p>
      </div>
    );
  }

  const slot = design.named[index];

  // ---------- empty named slot ----------
  if (slot === null) {
    return (
      <div className="focus">
        <div className="focus-who">
          <div>
            <div className="focus-name">{nodeLabel(index)}</div>
            <div className="focus-role">empty · generation {gen}</div>
          </div>
        </div>
        <button className="focus-pick" onClick={() => onOpenPicker(index)}>
          Choose from catalog…
        </button>
        <h4>This run's parents</h4>
        <div className="focus-rows">{kidRows(index)}</div>
      </div>
    );
  }

  // ---------- filled named node ----------
  const name = charaName(slot.chara_id) ?? `Chara ${slot.chara_id}`;
  const outfit = outfitFor(slot.card_id);
  const icon = iconIndex[String(slot.card_id)];
  const rows = aptitudeRows(design, index, aptitudesFor(slot.card_id));
  const undroppable = undroppableSpark(rows, design, index);

  return (
    <div className="focus">
      <div className="focus-who">
        {icon ? (
          <img className="focus-icon" src={`/icons/chara/${icon}`} alt="" loading="lazy" />
        ) : (
          <span className="lineage-icon-fallback focus-icon">{name.charAt(0)}</span>
        )}
        <div>
          <div className="focus-name">{name}</div>
          <div className="focus-role">
            {nodeLabel(index)}
            {outfit !== null && outfit !== "Original" ? ` · ${outfit}` : ""}
          </div>
        </div>
      </div>
      <div className="focus-actions">
        <button className="designer-secondary" onClick={() => onOpenPicker(index)}>
          Replace…
        </button>
        <button
          className="designer-secondary"
          onClick={() => onClear(index)}
          aria-label={`Clear ${nodeLabel(index)}`}
        >
          Clear
        </button>
      </div>
      <AptitudeTable rows={rows} />
      {index === 0 ? (
        <p className="focus-note">
          Run affinity and inspiration estimates return with the roster update.
        </p>
      ) : (
        <>
          <h4>Pink spark</h4>
          <PinkSparkEditor
            label={nodeLabel(index)}
            spark={slot.spark}
            onChange={(s) => onSetSpark(index, s)}
          />
          {undroppable && slot.spark !== null && (
            <p className="spark-warn" role="alert">
              This spark couldn't drop in game — {name}'s{" "}
              {APTITUDE_LABELS[slot.spark.aptitude]} resolves below A here, and pink sparks
              only generate at A.
            </p>
          )}
        </>
      )}
      <h4>This run's parents</h4>
      <div className="focus-rows">{kidRows(index)}</div>
    </div>
  );
}
