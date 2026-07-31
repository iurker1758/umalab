import { useEffect, useState } from "react";
import type { CatalogEntry } from "../api";
import { UmaCardChip } from "./UmaCardChip";

// What a pick resolves to. Card-level, not chara-level: base letters are
// per-CARD (Haru Urara's New Year outfit runs Mile A against her base B),
// so an alt outfit is a genuinely different pick.
export interface SlotPick {
  chara_id: number;
  card_id: number;
}

// Catalog-only in designer v1 — roster picks return with the roster update.
export function SlotPicker({
  title,
  catalog,
  iconIndex,
  conflict,
  onPick,
  onClose,
}: {
  title: string;
  catalog: CatalogEntry[];
  iconIndex: Record<string, string>;
  conflict: (charaId: number) => string | null;
  onPick: (pick: SlotPick) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const cards = catalog.flatMap((e) => e.cards.map((c) => ({ entry: e, card: c })));
  const queried = q
    ? cards.filter(({ entry, card }) => `${entry.name} ${card.outfit}`.toLowerCase().includes(q))
    : cards;

  return (
    <>
      {/* mousedown, not click — same cursor-freeze workaround as FilterPanel */}
      <div className="uma-popout-backdrop" onMouseDown={onClose} />
      <div className="uma-popout designer-picker" role="dialog" aria-label={title}>
        <header className="picker-head">
          <span className="filter-title">{title}</span>
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
          {queried.map(({ entry, card }) => (
            <UmaCardChip
              key={card.card_id}
              name={entry.name}
              outfit={card.outfit}
              icon={iconIndex[String(card.card_id)]}
              active={false}
              disabledReason={conflict(entry.chara_id) ?? undefined}
              onToggle={() => onPick({ chara_id: entry.chara_id, card_id: card.card_id })}
            />
          ))}
          {queried.length === 0 && <span className="empty">No characters match.</span>}
        </div>
      </div>
    </>
  );
}
