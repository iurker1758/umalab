import { useEffect, useMemo, useState } from "react";
import type { CatalogEntry, Veteran } from "../api";
import { APTITUDE_LABELS } from "../aptitude";
import { pinkOf } from "../blueprint";
import { UmaCardChip } from "./UmaCardChip";

// Two veterans trained from the same card are two chips with the same name.
// The pink each carries is what you'd pick between, so it labels them —
// and it's the value the pull is really after.
const vetNote = (v: Veteran): string => {
  const pink = pinkOf(v.factors);
  return pink === null ? "no pink" : `${pink.stars}★ ${APTITUDE_LABELS[pink.aptitude]}`;
};

// What a pick resolves to. Card-level, not chara-level: base letters are
// per-CARD (Haru Urara's New Year outfit runs Mile A against her base B),
// so an alt outfit is a genuinely different pick.
//
// A roster pick names the veteran instead: the caller reads its lineage,
// pink and won saddles off the roster row, none of which the catalog knows.
export type SlotPick =
  | { kind: "catalog"; chara_id: number; card_id: number }
  | { kind: "roster"; veteran: Veteran };

type Source = "catalog" | "roster";

export function SlotPicker({
  title,
  catalog,
  veterans,
  rosterBlocked = null,
  iconIndex,
  conflict,
  onPick,
  onClose,
}: {
  title: string;
  catalog: CatalogEntry[];
  veterans: Veteran[];
  // Why this node can't take a roster pick, or null when it can. Shown
  // rather than silently dropping the tab — a control that vanishes on one
  // node out of thirty-one reads as a bug.
  rosterBlocked?: string | null;
  iconIndex: Record<string, string>;
  conflict: (charaId: number) => string | null;
  onPick: (pick: SlotPick) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  // Catalog is the default source, always. A plan that starts from the
  // sparks you're hunting has to work against an empty roster — pulling a
  // veteran you already own is the shortcut, not the entry point.
  const [source, setSource] = useState<Source>("catalog");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const cards = useMemo(
    () => catalog.flatMap((e) => e.cards.map((c) => ({ entry: e, card: c }))),
    [catalog]
  );
  const queriedCards = q
    ? cards.filter(({ entry, card }) => `${entry.name} ${card.outfit}`.toLowerCase().includes(q))
    : cards;
  const queriedVets = q
    ? veterans.filter((v) => `${v.name} ${v.outfit}`.toLowerCase().includes(q))
    : veterans;

  // The roster tab is offered only when there's a roster to pull from and
  // this node can take one — an empty tab reads as a broken feature rather
  // than an unused one.
  const hasRoster = veterans.length > 0 && rosterBlocked === null;
  const showing: Source = hasRoster ? source : "catalog";

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
        {hasRoster && (
          <div className="seg-group picker-source" role="radiogroup" aria-label="Pick from">
            <button
              className={showing === "catalog" ? "seg active" : "seg"}
              aria-pressed={showing === "catalog"}
              onClick={() => setSource("catalog")}
            >
              Catalog
            </button>
            <button
              className={showing === "roster" ? "seg active" : "seg"}
              aria-pressed={showing === "roster"}
              onClick={() => setSource("roster")}
            >
              My roster
            </button>
          </div>
        )}
        <input
          className="uma-search"
          type="search"
          placeholder="Search by name…"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="filter-chips">
          {showing === "catalog"
            ? queriedCards.map(({ entry, card }) => (
                <UmaCardChip
                  key={card.card_id}
                  name={entry.name}
                  outfit={card.outfit}
                  icon={iconIndex[String(card.card_id)]}
                  active={false}
                  disabledReason={conflict(entry.chara_id) ?? undefined}
                  onToggle={() =>
                    onPick({ kind: "catalog", chara_id: entry.chara_id, card_id: card.card_id })
                  }
                />
              ))
            : queriedVets.map((v) => (
                // Keyed by trained_chara_id, not card_id: the same card can
                // appear many times in a roster, once per veteran you trained.
                <UmaCardChip
                  key={v.trained_chara_id}
                  name={v.name}
                  outfit={v.outfit}
                  icon={iconIndex[String(v.card_id)]}
                  active={false}
                  note={vetNote(v)}
                  disabledReason={conflict(v.chara_id) ?? undefined}
                  onToggle={() => onPick({ kind: "roster", veteran: v })}
                />
              ))}
          {(showing === "catalog" ? queriedCards : queriedVets).length === 0 && (
            <span className="empty">
              {showing === "catalog" ? "No characters match." : "No veterans match."}
            </span>
          )}
        </div>
        {showing === "roster" && (
          <p className="picker-note">
            Pulling a veteran replaces everything below this node with its own
            pedigree — parents, grandparents and their sparks.
          </p>
        )}
        {/* Only when there IS a roster: with none imported, the absence of a
            roster tab needs no explaining. */}
        {rosterBlocked !== null && veterans.length > 0 && (
          <p className="picker-note">{rosterBlocked}</p>
        )}
      </div>
    </>
  );
}
