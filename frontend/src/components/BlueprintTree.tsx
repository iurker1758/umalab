import type { AffinityResult, Veteran } from "../api";
import {
  SLOT_IDS,
  SLOT_LABELS,
  SLOT_LINK,
  resolveVeteran,
  type Design,
  type SlotId,
  type SlotValue,
} from "../blueprint";

function SlotTile({
  gridClass,
  label,
  name,
  icon,
  source,
  missing,
  linkPoints,
  linkTitle,
  onOpen,
  onClear,
}: {
  gridClass: string;
  label: string;
  name: string | null; // null ⇒ empty slot
  icon: string | undefined;
  source: "catalog" | "roster" | "lineage" | null;
  missing: boolean;
  linkPoints: number | null;
  linkTitle: string;
  onOpen: () => void;
  onClear: () => void;
}) {
  return (
    <div className={`slot-tile ${gridClass}`}>
      <span className="slot-label">{label}</span>
      {name !== null && (
        <button className="slot-clear" onClick={onClear} aria-label={`Clear ${label}`}>
          ×
        </button>
      )}
      <button className="slot-open" onClick={onOpen} aria-label={`Choose ${label}`}>
        {name === null ? (
          <span className="slot-empty-icon" aria-hidden="true">
            +
          </span>
        ) : icon ? (
          <img src={`/icons/chara/${icon}`} alt="" loading="lazy" />
        ) : (
          <span className="lineage-icon-fallback">{name.charAt(0)}</span>
        )}
        <span className="slot-name">{name ?? "Choose…"}</span>
      </button>
      {(source !== null || missing) && (
        <span className="slot-badges">
          {source !== null && <span className={`slot-source ${source}`}>{source}</span>}
          {missing && (
            <span
              className="slot-missing"
              title="The veteran behind this slot left the roster — it still scores from its snapshot"
            >
              not in roster
            </span>
          )}
        </span>
      )}
      {linkPoints !== null && (
        <span className="slot-link" title={linkTitle}>
          +{linkPoints}
        </span>
      )}
    </div>
  );
}

export function BlueprintTree({
  design,
  veterans,
  loaded,
  charaName,
  traineeIcon,
  iconIndex,
  affinity,
  onOpen,
  onClear,
}: {
  design: Design;
  veterans: Veteran[];
  loaded: boolean;
  charaName: (charaId: number) => string;
  traineeIcon: string | undefined;
  iconIndex: Record<string, string>;
  // null while below the scoring threshold — hides the per-link chips.
  affinity: AffinityResult | null;
  onOpen: (target: "trainee" | SlotId) => void;
  onClear: (target: "trainee" | SlotId) => void;
}) {
  const linkFor = (id: SlotId): [number | null, string] => {
    if (affinity === null || design.slots[id] === null) return [null, ""];
    const link = affinity.links.find((l) => l.link === SLOT_LINK[id]);
    if (link === undefined) return [null, ""];
    return [
      link.relation_points + link.win_points,
      `${link.relation_points} relation + ${link.win_points} G1 wins`,
    ];
  };

  const slotProps = (id: SlotId, slot: SlotValue | null) => {
    const [linkPoints, linkTitle] = linkFor(id);
    return {
      gridClass: `slot-${id}`,
      label: SLOT_LABELS[id],
      name: slot === null ? null : charaName(slot.chara_id),
      icon: slot === null ? undefined : iconIndex[String(slot.card_id)],
      source: slot?.source ?? null,
      // Only flag once the roster fetch finished — before that every
      // roster-backed slot would look missing for a moment.
      missing: slot !== null && slot.source !== "catalog" && loaded &&
        resolveVeteran(slot, veterans) === null,
      linkPoints,
      linkTitle,
      onOpen: () => onOpen(id),
      onClear: () => onClear(id),
    };
  };

  return (
    <div className="designer-tree">
      <SlotTile
        gridClass="slot-t"
        label="Trainee"
        name={design.trainee === null ? null : charaName(design.trainee)}
        icon={traineeIcon}
        source={null}
        missing={false}
        linkPoints={null}
        linkTitle=""
        onOpen={() => onOpen("trainee")}
        onClear={() => onClear("trainee")}
      />
      {SLOT_IDS.map((id) => (
        <SlotTile key={id} {...slotProps(id, design.slots[id])} />
      ))}
    </div>
  );
}
