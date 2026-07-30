import { MARK_IDS } from "../domain";
import { MarkIcon } from "./MarkIcon";

// The 4×4 mark grid shared by the veteran modal and the roster's bulk dock:
// a leading clear tile, then the 15 marks. Callers own what a pick means —
// onPick(null) is the clear tile, onPick(id) a mark tile.
export function MarkPicker({
  activeId,
  caption,
  clearTitle,
  tileTitle,
  activeTileTitle,
  popupClassName = "mark-popup",
  ariaLabel,
  onPick,
  onClose,
}: {
  // null → the clear tile renders active (the current state is "no mark");
  // undefined → nothing highlighted (e.g. a mixed bulk selection).
  activeId: string | null | undefined;
  caption?: string;
  clearTitle: string;
  tileTitle: string;
  activeTileTitle: string;
  popupClassName?: string;
  ariaLabel: string;
  onPick: (id: string | null) => void;
  onClose: () => void;
}) {
  return (
    <>
      {/* invisible click-away layer; parents stop propagation on their own
          surfaces, so this never closes anything behind them */}
      <span className="mark-popup-backdrop" onMouseDown={onClose} />
      <span className={popupClassName} role="dialog" aria-label={ariaLabel}>
        {caption && <span className="mark-caption">{caption}</span>}
        <button
          className={
            activeId === null ? "mark-toggle mark-clear active" : "mark-toggle mark-clear"
          }
          title={clearTitle}
          aria-label={clearTitle}
          onClick={() => onPick(null)}
        >
          <span className="mark-none" aria-hidden="true">
            ✕
          </span>
        </button>
        {MARK_IDS.map((id) => (
          <button
            key={id}
            className={id === activeId ? "mark-toggle active" : "mark-toggle"}
            title={id === activeId ? activeTileTitle : tileTitle}
            onClick={() => onPick(id)}
          >
            <MarkIcon id={id} />
          </button>
        ))}
      </span>
    </>
  );
}
