import { useEffect, useState } from "react";
import type { CatalogEntry, Veteran } from "../api";
import { UmaCardChip } from "./UmaCardChip";

// What a pick resolves to: the chara (base card for catalog picks) plus the
// backing veteran when it came from the My Veterans tab.
export interface SlotPick {
  chara_id: number;
  card_id: number;
  veteran: Veteran | null;
}

export function SlotPicker({
  title,
  catalog,
  veterans,
  iconIndex,
  conflict,
  onPick,
  onClose,
}: {
  title: string;
  catalog: CatalogEntry[];
  // null ⇒ catalog-only picker (the trainee never comes from the roster).
  veterans: Veteran[] | null;
  iconIndex: Record<string, string>;
  conflict: (charaId: number) => string | null;
  onPick: (pick: SlotPick) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"catalog" | "roster">("catalog");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const queriedCatalog = q
    ? catalog.filter((e) => e.name.toLowerCase().includes(q))
    : catalog;
  const queriedVeterans =
    veterans === null
      ? []
      : q
        ? veterans.filter((v) => `${v.name} ${v.outfit}`.toLowerCase().includes(q))
        : veterans;

  return (
    <>
      {/* mousedown, not click — same cursor-freeze workaround as FilterPanel */}
      <div className="uma-popout-backdrop" onMouseDown={onClose} />
      <div className="uma-popout designer-picker" role="dialog" aria-label={title}>
        <header className="picker-head">
          <span className="filter-title">{title}</span>
          {veterans !== null && (
            <span className="seg-group" role="radiogroup" aria-label="Pick from">
              <button
                className={tab === "catalog" ? "seg active" : "seg"}
                aria-pressed={tab === "catalog"}
                onClick={() => setTab("catalog")}
              >
                Catalog
              </button>
              <button
                className={tab === "roster" ? "seg active" : "seg"}
                aria-pressed={tab === "roster"}
                onClick={() => setTab("roster")}
              >
                My Veterans
              </button>
            </span>
          )}
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <input
          className="uma-search"
          type="search"
          placeholder="Search by name…"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="filter-chips">
          {tab === "catalog" || veterans === null ? (
            <>
              {queriedCatalog.map((e) => (
                <UmaCardChip
                  key={e.chara_id}
                  name={e.name}
                  icon={iconIndex[String(e.card_ids[0])]}
                  active={false}
                  disabledReason={conflict(e.chara_id) ?? undefined}
                  onToggle={() =>
                    onPick({ chara_id: e.chara_id, card_id: e.card_ids[0], veteran: null })
                  }
                />
              ))}
              {queriedCatalog.length === 0 && (
                <span className="empty">No characters match.</span>
              )}
            </>
          ) : (
            <>
              {queriedVeterans.map((v) => (
                <UmaCardChip
                  key={v.id}
                  name={v.name}
                  outfit={v.outfit}
                  icon={iconIndex[String(v.card_id)]}
                  active={false}
                  disabledReason={conflict(v.chara_id) ?? undefined}
                  onToggle={() =>
                    onPick({ chara_id: v.chara_id, card_id: v.card_id, veteran: v })
                  }
                />
              ))}
              {queriedVeterans.length === 0 && (
                <span className="empty">
                  {veterans.length === 0
                    ? "No roster yet — import a dump on the Roster page."
                    : "No veterans match."}
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
