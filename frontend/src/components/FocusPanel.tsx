import type { AptitudeLetters, PinkSpark } from "../api";
import { APTITUDE_LABELS, aptitudeRows, undroppableSpark } from "../aptitude";
import {
  NAMED_COUNT,
  deriveCharaId,
  nodeLabel,
  sparkAt,
  type Design,
  type SlotSource,
} from "../blueprint";
import { AptitudeTable } from "./AptitudeTable";
import { PinkSparkEditor } from "./PinkSparkEditor";

// Where a node came from, said plainly — it's what decides whether a later
// roster pull replaces this node in silence or stops to ask.
const SOURCE_NOTE: Record<SlotSource, string | null> = {
  catalog: null, // the default path; saying so would be noise on most nodes
  roster: "from your roster",
  lineage: "auto-filled from a roster pull",
};

// The docked focus panel (Option C): everything about the selected node —
// read and edit — lives here, so the map never needs popovers.
export function FocusPanel({
  design,
  index,
  iconIndex,
  charaName,
  outfitFor,
  aptitudesFor,
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
  onOpenPicker: (i: number) => void;
  onClear: (i: number) => void;
  onSetSpark: (i: number, spark: PinkSpark | null) => void;
}) {
  // No lineage lists here: the map already shows every node and is the one
  // place you navigate from, so a second, worse copy of it in the panel was
  // pure duplication.

  // ---------- deep spark slot ----------
  // Anonymous unless a roster pull filled it: the map has no room for a name
  // down here, so the identity that arrived with the pull is shown in the
  // panel and nowhere else. It is decoration — the bracket math above reads
  // aptitude and stars only.
  if (index >= NAMED_COUNT) {
    const spark = sparkAt(design, index);
    const pulled = spark?.card_id ?? null;
    const pulledOutfit = pulled === null ? null : outfitFor(pulled);
    const pulledName =
      pulled === null
        ? null
        : (charaName(deriveCharaId(pulled)) ?? `Card ${pulled}`) +
          (pulledOutfit !== null && pulledOutfit !== "Original" ? ` · ${pulledOutfit}` : "");
    return (
      <div className="focus">
        <div className="focus-who">
          <div className="focus-name">{nodeLabel(index)}</div>
          {pulledName !== null && (
            <div className="focus-role">{pulledName} · auto-filled from a roster pull</div>
          )}
        </div>
        {spark !== null && (
          <div className="focus-actions">
            <button
              className="designer-secondary"
              onClick={() => onClear(index)}
              aria-label={`Clear ${nodeLabel(index)}`}
            >
              Clear
            </button>
          </div>
        )}
        <h4>Pink spark</h4>
        <PinkSparkEditor
          label={nodeLabel(index)}
          spark={spark}
          onChange={(s) => onSetSpark(index, s)}
        />
      </div>
    );
  }

  const slot = design.named[index];

  // ---------- no character chosen (with or without a planned spark) ----------
  // The spark editor is here too: which pink a parent carries is a plan
  // input the bracket math needs, and planning usually starts from the
  // sparks you're hunting rather than from a cast. The trainee is exempt —
  // nothing is bred from it.
  if (slot === null || slot.chara_id === null || slot.card_id === null) {
    return (
      <div className="focus">
        <div className="focus-who">
          <div className="focus-name">{nodeLabel(index)}</div>
        </div>
        <button className="focus-pick" onClick={() => onOpenPicker(index)}>
          Choose character…
        </button>
        {/* A planned spark is state worth undoing, so Clear appears for it
            too — not only once a character is cast. */}
        {slot?.spark != null && (
          <div className="focus-actions">
            <button
              className="designer-secondary"
              onClick={() => onClear(index)}
              aria-label={`Clear ${nodeLabel(index)}`}
            >
              Clear
            </button>
          </div>
        )}
        {index > 0 && (
          <>
            <h4>Pink spark</h4>
            <PinkSparkEditor
              label={nodeLabel(index)}
              spark={slot?.spark ?? null}
              onChange={(s) => onSetSpark(index, s)}
            />
          </>
        )}
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
            {SOURCE_NOTE[slot.source] !== null ? ` · ${SOURCE_NOTE[slot.source]}` : ""}
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
        <p className="focus-note">Run affinity and inspiration estimates are still to come.</p>
      ) : (
        <>
          <h4>Pink spark</h4>
          <PinkSparkEditor
            label={nodeLabel(index)}
            spark={slot.spark}
            onChange={(s) => onSetSpark(index, s)}
          />
          {undroppable && slot.spark !== null && (
            <p
              className="spark-warn"
              role="alert"
              title="Pink sparks only generate on aptitudes the member reached A in."
            >
              {APTITUDE_LABELS[slot.spark.aptitude]} resolves below A — pinks only drop at A.
            </p>
          )}
        </>
      )}
    </div>
  );
}
