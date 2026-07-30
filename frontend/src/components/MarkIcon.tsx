import { MARK_ART } from "../assets/marks";
import { markLabel } from "../domain";

// Marks render from the committed original SVG set (DECISIONS.md #22) —
// bundled assets that can't 404, so there's no load-failure tracking here
// anymore. Only an id outside the committed set (stale reference data
// naming a mark this build doesn't know) degrades, to a numbered chip
// rather than hiding the mark.
export function MarkIcon({ id }: { id: string }) {
  const src = MARK_ART[id];
  const label = markLabel(id);
  return src ? (
    <img className="mark-icon" src={src} alt={label} title={label} />
  ) : (
    <span className="mark-fallback" title={label}>
      {Number(id.slice(-2))}
    </span>
  );
}
