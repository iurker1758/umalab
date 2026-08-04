import { useState } from "react";
import type {
  AffinityResult,
  AptitudeLetters,
  FactorRef,
  PinkSpark,
  SlotFactor,
} from "../api";
import type { SparkListStore } from "../sparks";
import { APTITUDE_LABELS, aptitudeRows, letterModeOf, undroppableSpark } from "../aptitude";
import {
  NAMED_COUNT,
  deepCardAt,
  deriveCharaId,
  lockedBy,
  nodeLabel,
  sparkAt,
  sparkLocked,
  type Design,
} from "../blueprint";
import { sparkId, type SparkSort } from "../procs";
import { ReplaceIcon, TrashIcon } from "./icons";
import { AffinityPanel, NodeAffinity } from "./AffinityPanel";
import { AptitudeTable } from "./AptitudeTable";
import { PinkSparkEditor } from "./PinkSparkEditor";
import { NodeProcs, TraineeProcs } from "./ProcPanel";

// A locked node's pink, shown rather than edited. Same shape as the editor's
// readout so the panel doesn't jump when you move between locked and free
// nodes.
const SparkReadout = ({ spark }: { spark: PinkSpark | null }) =>
  spark === null ? (
    <p className="focus-note">No pink spark.</p>
  ) : (
    <div className="spark-editor">
      <span className="spark-static">
        {APTITUDE_LABELS[spark.aptitude]}
        <span className="spark-stars">
          {[1, 2, 3].map((n) => (
            <span key={n} className={n <= spark.stars ? "star filled" : "star"}>
              ★
            </span>
          ))}
        </span>
      </span>
    </div>
  );

// Why this node can't be edited, said once at the bottom of the panel.
const LockNote = ({ owner }: { owner: number }) => (
  <p className="focus-note">{nodeLabel(owner)}&apos;s real pedigree.</p>
);

// `aria-label` names the TARGET ("Clear Grandparent 1-2"), because "Clear"
// alone is ambiguous on a panel you reached by clicking one of 31 tiles;
// `title` is the short generic tooltip, so an unfamiliar icon is discoverable
// on hover. They must NOT be the same string — a `title` matching the
// accessible name becomes the accessible DESCRIPTION, and screen readers then
// read the node twice.
const NodeActions = ({
  index,
  onReplace,
  onClear,
}: {
  // The node itself, not its label: a caller passing `nodeLabel(index)` beside
  // handlers already closed over that index could mislabel a destructive
  // button silently.
  index: number;
  // Null where the action doesn't apply — nobody cast to replace, or nothing
  // in the node to clear. Taking the character off while keeping the sparks
  // is the picker's No Character chip, not a third button here
  // (DECISIONS.md #31).
  onReplace: (() => void) | null;
  onClear: (() => void) | null;
}) =>
  onReplace === null && onClear === null ? null : (
    <div className="focus-actions">
      {onReplace !== null && (
        <button
          className="bar-icon"
          title="Replace this character"
          aria-label={`Replace ${nodeLabel(index)}`}
          onClick={onReplace}
        >
          <ReplaceIcon />
        </button>
      )}
      {onClear !== null && (
        <button
          className="bar-icon bar-icon-danger"
          title="Clear this node"
          aria-label={`Clear ${nodeLabel(index)}`}
          onClick={onClear}
        >
          <TrashIcon />
        </button>
      )}
    </div>
  );

// The tab's id stays `procs` while its label reads "Sparks": the estimate it
// carries is still an inspiration proc, which is what `procs.ts`, the
// `.proc-*` styles and DECISIONS.md #30's model are all named for.
//
// Details keeps its PINK SPARK section deliberately — the pink sits beside the
// ten letters it bumps at career start (DECISIONS.md #26/#30). Don't "tidy" it
// onto this tab.
type Tab = "details" | "procs";

// Two buttons, not a `role="tablist"`: real tab semantics promise arrow-key
// navigation between them that nothing here implements, and announcing a
// contract we don't keep is worse than announcing none.
const FocusTabs = ({
  index,
  tab,
  onPick,
}: {
  // The node, not its label — same reason as NodeActions.
  index: number;
  tab: Tab;
  onPick: (t: Tab) => void;
}) => (
  <div className="focus-tabs seg-group" role="group" aria-label={`${nodeLabel(index)} sections`}>
    {(["details", "procs"] as const).map((t) => (
      <button
        key={t}
        className={tab === t ? "focus-tab seg active" : "focus-tab seg"}
        aria-pressed={tab === t}
        onClick={() => onPick(t)}
      >
        {t === "details" ? "Details" : "Sparks"}
      </button>
    ))}
  </div>
);

// The docked focus panel (Option C): everything about the selected node —
// read and edit — lives here, so the map never needs popovers.
export function FocusPanel({
  design,
  index,
  iconIndex,
  charaName,
  outfitFor,
  aptitudesFor,
  affinity,
  affinityFailed,
  affinityPending,
  factorRefs,
  sparkLists,
  cardOwner,
  onOpenPicker,
  onClear,
  onSetSpark,
  onSetFactors,
  onError,
}: {
  design: Design;
  index: number;
  iconIndex: Record<string, string>;
  charaName: (charaId: number) => string | null;
  outfitFor: (cardId: number) => string | null;
  aptitudesFor: (cardId: number) => AptitudeLetters | null;
  // The trainee's run affinity, scored server-side. Null below the scoring
  // threshold (no trainee, or no parent) as well as before the first result.
  affinity: AffinityResult | null;
  affinityFailed: boolean;
  // A score is on the wire — see AffinityPanel's `pending`.
  affinityPending: boolean;
  // The pickable sparks, from the committed factor reference. Empty until the
  // fetch lands, which costs the hand-entry search its results and shows
  // stored sparks by key — every CHANCE on the Procs tab reads the design,
  // not this.
  factorRefs: FactorRef[];
  // Forwarded untouched: only the chooser reads it, and the reference is
  // committed and works offline, so a favorites list that didn't load costs an
  // ordering and nothing else.
  sparkLists: SparkListStore;
  // Names the uma a green spark belongs to, for the chooser's green rows.
  cardOwner: (cardId: number) => string | null;
  onOpenPicker: (i: number) => void;
  onClear: (i: number) => void;
  onSetSpark: (i: number, spark: PinkSpark | null) => void;
  onSetFactors: (i: number, update: (current: readonly SlotFactor[]) => SlotFactor[]) => void;
  onError: (message: string) => void;
}) {
  // Which tab, kept across node switches on purpose: comparing the same view
  // between two ancestors is the common move, and resetting to Details every
  // time you click the map would undo it. Nodes with nothing to show in Procs
  // — deep slots, and the trainee before anyone is cast — simply render
  // Details and no tab bar.
  const [tab, setTab] = useState<Tab>("details");
  // Two sort states, because the tables answer different questions and start
  // from different defaults (DECISIONS.md #34): an ancestor's chances are a
  // pure function of (kind, ★) at her single affinity, so ranking is a tie for
  // most of its length and grouping is the only ordering that informs; the
  // trainee's is a union across carriers at differing affinities, where the
  // ranking is real. One shared state would lose one of the two defaults.
  const [ancestorSort, setAncestorSort] = useState<SparkSort>("kind");
  const [traineeSort, setTraineeSort] = useState<SparkSort>("chance");
  // Keyed by kind AND key: the kinds number their keys independently, so a
  // bare key would collide across them.
  const sparkNames = new Map(factorRefs.map((f) => [sparkId({ type: f.kind, key: f.key }), f.name]));
  // No lineage lists here, deliberately: the map already shows every node and
  // is the one place you navigate from, so a second copy in the panel is
  // duplication. Don't re-add one.

  // ---------- deep spark slot ----------
  // Anonymous unless a roster pull filled it: the map has no room for a name
  // down here, so the identity that arrived with the pull is shown in the
  // panel and nowhere else. It is decoration — the bracket math above reads
  // aptitude and stars only.
  // Locked ⇒ this node sits under a veteran pulled from the roster, so every
  // control below renders as a readout instead.
  const locked = lockedBy(design, index);
  // A superset of `locked`: the roster node itself keeps its Replace/Clear
  // buttons but not its spark editor — that pink is the horse's own.
  const pinkFixed = sparkLocked(design, index);

  if (index >= NAMED_COUNT) {
    const spark = sparkAt(design, index);
    const pulled = deepCardAt(design, index);
    const pulledOutfit = pulled === null ? null : outfitFor(pulled);
    // Null until the catalog resolves, so the role line appears with the
    // right name rather than flashing a placeholder.
    const pulledChara = pulled === null ? null : charaName(deriveCharaId(pulled));
    const pulledName =
      pulledChara === null
        ? null
        : pulledChara +
          (pulledOutfit !== null && pulledOutfit !== "Original" ? ` · ${pulledOutfit}` : "");
    return (
      <div className="focus">
        <div className="focus-who">
          <div className="focus-name">{nodeLabel(index)}</div>
          {pulledName !== null && <div className="focus-role">{pulledName}</div>}
          {locked === null && (
            <NodeActions
              index={index}
              // Nobody cast yet ⇒ nothing to replace; the dashed button below
              // is the cast action. Nothing in the slot ⇒ nothing to undo.
              onReplace={pulled === null ? null : () => onOpenPicker(index)}
              onClear={spark !== null || pulled !== null ? () => onClear(index) : null}
            />
          )}
        </div>
        {/* Offered on an empty slot too, exactly as the named nodes are:
            casting a character before deciding their pink is a normal way to
            plan, and the document holds either half on its own. */}
        {locked === null && pulled === null && (
          <button className="focus-pick" onClick={() => onOpenPicker(index)}>
            Choose Character
          </button>
        )}
        <h4>Pink Spark</h4>
        {/* Fixed on a roster pick here for the same reason as on a parent:
            that pink is the horse's own. Its identity stays replaceable. */}
        {pinkFixed ? <SparkReadout spark={spark} /> : (
          <PinkSparkEditor
            label={nodeLabel(index)}
            spark={spark}
            onChange={(s) => onSetSpark(index, s)}
          />
        )}
        {locked !== null && <LockNote owner={locked} />}
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
    // Empty AND locked: the veteran above simply has nobody in this slot, so
    // there is nothing to show and nothing to fill it with.
    if (locked !== null) {
      return (
        <div className="focus">
          <div className="focus-who">
            <div className="focus-name">{nodeLabel(index)}</div>
          </div>
          <LockNote owner={locked} />
        </div>
      );
    }
    return (
      <div className="focus">
        <div className="focus-who">
          <div className="focus-name">{nodeLabel(index)}</div>
          {/* A planned spark of any kind is state worth undoing, so Clear
              appears without a cast. No Replace: nobody is in the node. */}
          {slot !== null && (
            <NodeActions
              index={index}
              onReplace={null}
              onClear={() => onClear(index)}
            />
          )}
        </div>
        <button className="focus-pick" onClick={() => onOpenPicker(index)}>
          Choose Character
        </button>
        {index > 0 ? (
          <>
            {/* Tabbed exactly as a cast node is: gating the tab on a cast (or
                on a score) would put the only spark editor behind the thing
                you haven't decided yet. */}
            <FocusTabs index={index} tab={tab} onPick={setTab} />
            {tab === "procs" ? (
              <NodeProcs
                design={design}
                affinity={affinity}
                index={index}
                sparkNames={sparkNames}
                factorRefs={factorRefs}
                sparkLists={sparkLists}
                cardOwner={cardOwner}
                locked={false}
                sort={ancestorSort}
                onSort={setAncestorSort}
                onSetFactors={onSetFactors}
                onError={onError}
              />
            ) : (
              <>
                <h4>Pink Spark</h4>
                <PinkSparkEditor
                  label={nodeLabel(index)}
                  spark={slot?.spark ?? null}
                  onChange={(s) => onSetSpark(index, s)}
                />
              </>
            )}
          </>
        ) : (
          // The trainee with nobody cast yet: the section is what says the
          // score is waiting on a pick, rather than the panel simply not
          // mentioning affinity until you happen to fill two nodes.
          <AffinityPanel
            affinity={affinity}
            failed={affinityFailed}
            pending={affinityPending}
            traineeSet={false}
          />
        )}
      </div>
    );
  }

  // ---------- filled named node ----------
  // Empty string, not a placeholder id: the heading holds its line while the
  // catalog is in flight and fills in, rather than showing a number that's
  // about to be replaced.
  const name = charaName(slot.chara_id) ?? "";
  const outfit = outfitFor(slot.card_id);
  const icon = iconIndex[String(slot.card_id)];
  const rows = aptitudeRows(
    design,
    index,
    aptitudesFor(slot.card_id),
    letterModeOf(slot),
    slot.aptitudes
  );
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
        {locked === null && (
          <NodeActions
            index={index}
            onReplace={() => onOpenPicker(index)}
            onClear={() => onClear(index)}
          />
        )}
      </div>
      {/* Never gated on a score: the chances read "—" until one lands, but the
          tab is also where a member's sparks are TYPED, and hiding the only
          editor behind a scorable design would hide the sparks with it. */}
      <FocusTabs index={index} tab={tab} onPick={setTab} />
      {tab === "procs" ? (
        index === 0 ? (
          <TraineeProcs
            design={design}
            affinity={affinity}
            sparkNames={sparkNames}
            sort={traineeSort}
            onSort={setTraineeSort}
          />
        ) : (
          <NodeProcs
            design={design}
            affinity={affinity}
            index={index}
            sparkNames={sparkNames}
            factorRefs={factorRefs}
            sparkLists={sparkLists}
            cardOwner={cardOwner}
            locked={pinkFixed}
            sort={ancestorSort}
            onSort={setAncestorSort}
            onSetFactors={onSetFactors}
            onError={onError}
          />
        )
      ) : (
        <>
          {/* Affinity leads the tab: it is the node's headline number, and the
              ten letters below it are detail you consult. Ancestors get their
              own share, never the run's total. */}
          {index === 0 ? (
            <AffinityPanel
              affinity={affinity}
              failed={affinityFailed}
              pending={affinityPending}
              traineeSet
            />
          ) : (
            <NodeAffinity affinity={affinity} index={index} />
          )}
          <AptitudeTable rows={rows} />
          {index > 0 && (
            <>
              <h4>Pink Spark</h4>
              {pinkFixed ? (
                <SparkReadout spark={slot.spark} />
              ) : (
                <PinkSparkEditor
                  label={nodeLabel(index)}
                  spark={slot.spark}
                  onChange={(s) => onSetSpark(index, s)}
                />
              )}
            </>
          )}
        </>
      )}
      {/* Outside the switch: the tab choice persists across node switches, so
          a guardrail that only rendered on Details would never reach someone
          reading procs down the tree. */}
      {undroppable && slot.spark !== null && (
        <p
          className="spark-warn"
          role="alert"
          title="Pink sparks only generate on aptitudes the member reached A in."
        >
          {APTITUDE_LABELS[slot.spark.aptitude]} resolves below A — pinks only drop at A.
        </p>
      )}
      {locked !== null && <LockNote owner={locked} />}
    </div>
  );
}
