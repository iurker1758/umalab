// The caption and sort pills shared by both bottom docks — the roster page's
// and the slot picker's (issue #99). Persistence stays with the caller: each
// surface saves to its own store, so these only render and report the next
// value.
import {
  CAPTION_LABELS,
  DEFAULT_ASC,
  SORTS,
  nextCaptionMode,
  type CaptionMode,
  type SortKey,
  type SortPref,
} from "../domain";

export function CaptionPill({
  caption,
  onChange,
}: {
  caption: CaptionMode;
  onChange: (next: CaptionMode) => void;
}) {
  return (
    <button
      className="filter-float caption-float"
      title={`Captions: ${CAPTION_LABELS[caption]} — click for ${CAPTION_LABELS[nextCaptionMode(caption)]}`}
      aria-label={`Captions: ${CAPTION_LABELS[caption]}`}
      onClick={() => onChange(nextCaptionMode(caption))}
    >
      {CAPTION_LABELS[caption]}
    </button>
  );
}

export function SortPill({
  sort,
  onChange,
  selectLabel,
}: {
  sort: SortPref;
  onChange: (next: SortPref) => void;
  // "Sort By" on the roster, "Sort Roster By" in the picker — the two
  // controls sort different things and their accessible names say which.
  selectLabel: string;
}) {
  return (
    <label className="sort-float">
      <select
        aria-label={selectLabel}
        value={sort.key}
        onChange={(e) => {
          const key = e.target.value as SortKey;
          onChange({ key, asc: DEFAULT_ASC[key] });
        }}
      >
        {SORTS.map(([label, key]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
      <button
        className="sort-dir"
        title={sort.asc ? "Ascending — click for descending" : "Descending — click for ascending"}
        aria-label={sort.asc ? "Sort Ascending" : "Sort Descending"}
        onClick={() => onChange({ ...sort, asc: !sort.asc })}
      >
        {sort.asc ? "▲" : "▼"}
      </button>
    </label>
  );
}
