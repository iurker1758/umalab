import { useState } from "react";

// One 404 per mark id is enough — remember which ids lack art so later
// MarkIcon mounts go straight to the numbered fallback instead of re-firing
// the same requests on every modal open. Per-id, not a single flag: the
// extraction script can leave a partial set (sprites missing from the atlas
// are skipped with a warning), and one absent PNG must not suppress the rest.
const missingMarkArt = new Set<string>();

export function MarkIcon({ id }: { id: string }) {
  // failed is state derived from the id prop: a reused instance whose id
  // changes (e.g. the modal's mark button after picking a different mark)
  // must re-derive, or one missing PNG sticks to every mark shown after it.
  const [state, setState] = useState({ id, failed: missingMarkArt.has(id) });
  if (state.id !== id) setState({ id, failed: missingMarkArt.has(id) });
  const label = `Mark ${Number(id.slice(-2))}`;
  return state.failed ? (
    <span className="mark-fallback" title={label}>
      {Number(id.slice(-2))}
    </span>
  ) : (
    <img
      className="mark-icon"
      src={`/icons/marks/${id}.png`}
      alt={label}
      title={label}
      onError={() => {
        missingMarkArt.add(id);
        setState({ id, failed: true });
      }}
    />
  );
}
