import { useState } from "react";
import type {
  AffinityResult,
  AptitudeLetters,
  FactorRef,
  PinkSpark,
  SlotFactor,
} from "../api";
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
import { sparkId } from "../procs";
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

type Tab = "details" | "procs";

// Two buttons, not a `role="tablist"`. They behave like the app's other
// segmented controls — click to switch, `aria-pressed` for state — and real
// tab semantics promise arrow-key navigation between them that nothing here
// implements. Announcing a contract we don't keep is worse than announcing
// none.
const FocusTabs = ({
  label,
  tab,
  onPick,
}: {
  label: string;
  tab: Tab;
  onPick: (t: Tab) => void;
}) => (
  <div className="focus-tabs" role="group" aria-label={`${label} sections`}>
    {(["details", "procs"] as const).map((t) => (
      <button
        key={t}
        className={tab === t ? "focus-tab active" : "focus-tab"}
        aria-pressed={tab === t}
        onClick={() => onPick(t)}
      >
        {t === "details" ? "Details" : "Procs"}
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
  onOpenPicker,
  onClear,
  onSetSpark,
  onSetFactors,
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
  onOpenPicker: (i: number) => void;
  onClear: (i: number) => void;
  onSetSpark: (i: number, spark: PinkSpark | null) => void;
  onSetFactors: (i: number, factors: SlotFactor[]) => void;
}) {
  // Which tab, kept across node switches on purpose: comparing the same view
  // between two ancestors is the common move, and resetting to Details every
  // time you click the map would undo it. Nodes with nothing to show in Procs
  // — deep slots, and the trainee before anyone is cast — simply render
  // Details and no tab bar.
  const [tab, setTab] = useState<Tab>("details");
  // Keyed by kind AND key, as the sparks themselves are: the kinds number
  // their keys independently, so a bare key would collide across them. Built
  // above the early returns because every branch that can show sparks needs
  // it.
  const sparkNames = new Map(factorRefs.map((f) => [sparkId({ type: f.kind, key: f.key }), f.name]));
  // No lineage lists here: the map already shows every node and is the one
  // place you navigate from, so a second, worse copy of it in the panel was
  // pure duplication.

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
        </div>
        {/* Offered on an empty slot too, exactly as the named nodes are:
            casting a character before deciding their pink is a normal way to
            plan, and the document holds either half on its own. */}
        {locked === null && (
          <div className="focus-actions">
            <button className="designer-secondary" onClick={() => onOpenPicker(index)}>
              {pulled === null ? "Choose Character…" : "Replace…"}
            </button>
            {/* Nothing in the slot, nothing to undo — same rule as above. */}
            {(spark !== null || pulled !== null) && (
              <button
                className="designer-secondary"
                onClick={() => onClear(index)}
                aria-label={`Clear ${nodeLabel(index)}`}
              >
                Clear
              </button>
            )}
          </div>
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
        </div>
        <button className="focus-pick" onClick={() => onOpenPicker(index)}>
          Choose Character…
        </button>
        {/* A planned spark is state worth undoing, so Clear appears for it
            too — not only once a character is cast. Any spark: a node planned
            around the whites you're hunting is as real as one planned around
            a pink, and the server stores either on its own. */}
        {slot !== null && (
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
        {index > 0 ? (
          <>
            {/* Tabbed exactly as a cast node is. Spark entry lives on Procs,
                and a member planned by spark alone is the case that most
                needs it — gating the tab on a cast (or on a score) would put
                the only editor behind the thing you haven't decided yet. */}
            <FocusTabs label={nodeLabel(index)} tab={tab} onPick={setTab} />
            {tab === "procs" ? (
              <NodeProcs
                design={design}
                affinity={affinity}
                index={index}
                sparkNames={sparkNames}
                factorRefs={factorRefs}
                locked={false}
                onSetFactors={onSetFactors}
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
      </div>
      {locked === null && (
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
      )}
      {/* Always offered, never gated on a score. The chances behind it are
          this member's affinity times a spark, so before one lands they read
          "—" — but the tab is also where a member's sparks are TYPED, and
          hiding the only editor until the design happens to be scorable
          (or until the backend answers) made entered sparks vanish with it. */}
      <FocusTabs label={nodeLabel(index)} tab={tab} onPick={setTab} />
      {tab === "procs" ? (
        index === 0 ? (
          <TraineeProcs design={design} affinity={affinity} sparkNames={sparkNames} />
        ) : (
          <NodeProcs
            design={design}
            affinity={affinity}
            index={index}
            sparkNames={sparkNames}
            factorRefs={factorRefs}
            locked={pinkFixed}
            onSetFactors={onSetFactors}
          />
        )
      ) : (
        <>
          <AptitudeTable rows={rows} />
          {index === 0 ? (
            <AffinityPanel
              affinity={affinity}
              failed={affinityFailed}
              pending={affinityPending}
              traineeSet
            />
          ) : (
            <>
              {/* Ancestors get their own affinity, not the run's — the number
                  a proc off them rolls against. Above the spark editor: it is
                  what decides whether the pink below it ever lands. */}
              <NodeAffinity affinity={affinity} index={index} />
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
      {/* Both tabs, outside the switch. The tab choice persists across node
          switches, so anything that only rendered on Details would never
          reach someone reading procs down the tree — and these two are the
          panel's guardrails, not part of either view. */}
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
