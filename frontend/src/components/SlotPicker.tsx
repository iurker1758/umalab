import { useEffect, useMemo, useState } from "react";
import type { CatalogEntry, Veteran } from "../api";
import { APTITUDE_LABELS } from "../aptitude";
import {
  CAPTION_LABELS,
  DEFAULT_ASC,
  PICKER_CAPTION_STORE,
  PICKER_SORT_STORE,
  SORTS,
  loadCaptionMode,
  loadSortPref,
  nextCaptionMode,
  pinkOf,
  rosterCardsOf,
  saveCaptionMode,
  saveSortPref,
  sortVeterans,
  type CaptionMode,
  type SortKey,
  type SortPref,
} from "../domain";
import {
  PICKER_FILTER_STORE,
  commonSparkNamesOf,
  countFilters,
  loadFilters,
  matchesFilters,
  reconcileFilters,
  saveFilters,
  type Filters,
} from "../filters";
import { FilterPanel } from "./FilterPanel";
import { PopoutBackdrop } from "./popout";
import { UmaCardChip } from "./UmaCardChip";
import { VeteranCard } from "./VeteranCard";

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

// Two veterans trained from the same card are two chips with the same name.
// The pink each carries is what you'd pick between, so it labels them —
// and it's the value the pull is really after.
const vetNote = (v: Veteran): string => {
  const pink = pinkOf(v.factors);
  return pink === null ? "no pink" : `${pink.stars}★ ${APTITUDE_LABELS[pink.aptitude]}`;
};

export function SlotPicker({
  title,
  catalog,
  veterans,
  rosterBlocked = false,
  iconIndex,
  conflict,
  onPick,
  onUnselect,
  onClose,
}: {
  title: string;
  catalog: CatalogEntry[];
  veterans: Veteran[];
  // Set when this node can't take a roster pick (the trainee isn't in your
  // roster). The tab strip simply doesn't render — the trainee is the one
  // node nobody expects to find in a list of horses they've trained.
  rosterBlocked?: boolean;
  iconIndex: Record<string, string>;
  // Asked per tab, because the two picks aren't the same action: a catalog
  // pick fills one node, a roster pull replaces the target's whole subtree,
  // and the tree rules that bite differ accordingly.
  conflict: (charaId: number, kind: Source) => string | null;
  onPick: (pick: SlotPick) => void;
  // Take the node's character off and keep its sparks — the No Character
  // chip. Null where that isn't offered: an empty node, a pulled one, or one
  // with nothing to keep (DECISIONS.md #31).
  onUnselect: (() => void) | null;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  // Catalog is the default source, always. A plan that starts from the
  // sparks you're hunting has to work against an empty roster — pulling a
  // veteran you already own is the shortcut, not the entry point.
  const [source, setSource] = useState<Source>("catalog");
  // Sort and filters persist under the picker's OWN keys, never the roster
  // page's: the two surfaces stay independent, but filling 31 nodes against
  // one criterion is the designer's most repeated work (DECISIONS.md #31).
  const [sort, setSortState] = useState<SortPref>(() => loadSortPref(PICKER_SORT_STORE));
  const setSort = (next: SortPref) => {
    setSortState(next);
    saveSortPref(next, PICKER_SORT_STORE);
  };
  const [caption, setCaptionState] = useState<CaptionMode>(() =>
    loadCaptionMode(PICKER_CAPTION_STORE)
  );
  const setCaption = (next: CaptionMode) => {
    setCaptionState(next);
    saveCaptionMode(next, PICKER_CAPTION_STORE);
  };
  // Reconciled at mount as the shell does on every roster load — a card or
  // mark filter whose target left in a full-replace import would otherwise
  // open the picker on nothing, with no visible cause.
  const [filters, setFiltersState] = useState<Filters>(() => {
    const saved = loadFilters(PICKER_FILTER_STORE);
    // Only against a roster that has actually arrived. `veterans` starts empty
    // and stays empty if the fetch fails, so reconciling against nothing would
    // strip every filter the moment the picker opened on a slow load, and the
    // next chip you touched would persist the stripped set.
    if (veterans.length === 0) return saved;
    const next = reconcileFilters(saved, veterans);
    // Written back, not just applied: a filter whose target left is CLEARED,
    // not masked, and a stale entry left in storage would reactivate silently
    // the next time an import brings that veteran back. Identity is the
    // signal — reconcileFilters returns its input untouched when nothing
    // changed.
    if (next !== saved) saveFilters(next, PICKER_FILTER_STORE);
    return next;
  });
  const setFilters = (next: Filters) => {
    setFiltersState(next);
    saveFilters(next, PICKER_FILTER_STORE);
  };
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    // The filter panel owns Escape while it's open — it has its own layered
    // handler (uma/spark popouts first, then itself). Without this guard both
    // fire and one Escape closes the picker out from under it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !filterOpen) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, filterOpen]);

  const q = query.trim().toLowerCase();
  const cards = useMemo(
    () => catalog.flatMap((e) => e.cards.map((c) => ({ entry: e, card: c }))),
    [catalog]
  );
  const queriedCards = q
    ? cards.filter(({ entry, card }) => `${entry.name} ${card.outfit}`.toLowerCase().includes(q))
    : cards;

  // The roster tab is offered only when there's a roster to pull from and
  // this node can take one — an empty tab reads as a broken feature rather
  // than an unused one.
  const hasRoster = veterans.length > 0 && !rosterBlocked;
  const showing: Source = hasRoster ? source : "catalog";

  // The same two lists the roster page feeds its panel, from the same
  // helpers: one entry per distinct card for the Umas section, every
  // common-spark name for the search.
  const rosterCards = useMemo(() => rosterCardsOf(veterans), [veterans]);
  const commonSparkNames = useMemo(() => commonSparkNamesOf(veterans), [veterans]);

  // Filtered first, then name-searched: the count the panel reports is about
  // ITS filters, so the search box narrowing further mustn't change it.
  const filteredVets = useMemo(
    () => veterans.filter((v) => matchesFilters(v, filters)),
    [veterans, filters]
  );
  // Not name-searched: that box is the catalog's. A stale query left behind
  // by the other tab must not silently narrow this list from a control that
  // isn't on screen.
  const shownVets = useMemo(() => sortVeterans(filteredVets, sort), [filteredVets, sort]);

  const empty = showing === "catalog" ? queriedCards.length === 0 : shownVets.length === 0;

  return (
    <>
      <PopoutBackdrop onClose={onClose} />
      <div className="uma-popout designer-picker" role="dialog" aria-label={title}>
        <header className="picker-head">
          <span className="filter-title">{title}</span>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        {hasRoster && (
          <div className="seg-group picker-source" role="radiogroup" aria-label="Pick From">
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
              My Roster
            </button>
          </div>
        )}
        {/* Catalog only. It's the sole way to find one of ~95 characters
            there, whereas the roster has the panel's Umas section — and a
            search box that only narrows by name is the weakest of the three
            controls the roster tab now offers. */}
        {showing === "catalog" && (
          <input
            className="uma-search"
            type="search"
            placeholder="Search by Name…"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        {/* Catalog chips wrap as a chip cloud; roster cards are the roster
            page's tiles and want its grid, so rank badges and score lines
            align across rows instead of stair-stepping. */}
        <div className={showing === "roster" ? "picker-grid" : "filter-chips"}>
          {/* "Nobody, for now" — first in the character list, in the shape the
              filter panel's No Favorite chip already uses. Taking the face off
              a node is an answer to the question the picker asks, not a
              separate control beside it. Null unless the node has a
              hand-picked character and something to keep. */}
          {showing === "catalog" && onUnselect !== null && (
            <button
              className="card-chip picker-unselect"
              title="No Character"
              aria-label="No Character"
              onClick={onUnselect}
            >
              <span className="chip-none" aria-hidden="true">
                ✕
              </span>
            </button>
          )}
          {showing === "catalog"
            ? queriedCards.map(({ entry, card }) => (
                <UmaCardChip
                  key={card.card_id}
                  name={entry.name}
                  outfit={card.outfit}
                  icon={iconIndex[String(card.card_id)]}
                  active={false}
                  disabledReason={conflict(entry.chara_id, "catalog") ?? undefined}
                  onToggle={() =>
                    onPick({ kind: "catalog", chara_id: entry.chara_id, card_id: card.card_id })
                  }
                />
              ))
            : shownVets.map((v) => (
                // The roster page's own card, not a bare chip: picking a
                // veteran is the same act of recognition as browsing them.
                // Keyed by trained_chara_id, not card_id — the same card
                // appears once per veteran you trained.
                <VeteranCard
                  key={v.trained_chara_id}
                  v={v}
                  icon={iconIndex[String(v.card_id)]}
                  // Manual and under the picker's own key, like the sort and
                  // filters — cycle to Sparks and the pink a pull is really
                  // after is on the card (issue #40); `note` keeps it in the
                  // accessible name either way.
                  caption={caption}
                  note={vetNote(v)}
                  disabledReason={conflict(v.chara_id, "roster") ?? undefined}
                  onOpen={() => onPick({ kind: "roster", veteran: v })}
                />
              ))}
          {empty && (
            <span className="empty">
              {showing === "catalog"
                ? "No characters match."
                : countFilters(filters) > 0
                  ? "No veterans match the filters."
                  : "No veterans in your roster."}
            </span>
          )}
        </div>
        {/* Roster only: the catalog is one card per outfit, with no rating,
            acquisition date or marks to act on. Sticky at the picker's
            bottom-right like the roster's own dock — the chip list is the
            thing that scrolls, and these have to stay reachable through all
            159 of them. Last in the DOM so it doesn't precede the list it
            controls for a screen reader. */}
        {showing === "roster" && (
          <div className="pill-dock picker-dock">
            <button className="filter-float" onClick={() => setFilterOpen(true)}>
              Filters
              {countFilters(filters) > 0 && (
                <span className="filter-count">{countFilters(filters)}</span>
              )}
            </button>
            <button
              className="filter-float caption-float"
              title={`Captions: ${CAPTION_LABELS[caption]} — click for ${CAPTION_LABELS[nextCaptionMode(caption)]}`}
              aria-label={`Captions: ${CAPTION_LABELS[caption]}`}
              onClick={() => setCaption(nextCaptionMode(caption))}
            >
              {CAPTION_LABELS[caption]}
            </button>
            <label className="sort-float">
              <select
                aria-label="Sort Roster By"
                value={sort.key}
                onChange={(e) => {
                  const key = e.target.value as SortKey;
                  setSort({ key, asc: DEFAULT_ASC[key] });
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
                title={
                  sort.asc
                    ? "Ascending — click for descending"
                    : "Descending — click for ascending"
                }
                aria-label={sort.asc ? "Sort Ascending" : "Sort Descending"}
                onClick={() => setSort({ ...sort, asc: !sort.asc })}
              >
                {sort.asc ? "▲" : "▼"}
              </button>
            </label>
          </div>
        )}
      </div>
      {filterOpen && (
        // The roster page's own panel, wrapped so it can be lifted above the
        // picker — its own z-index sits below the popout layer.
        <div className="picker-filters">
          <FilterPanel
            filters={filters}
            cards={rosterCards}
            whiteNames={commonSparkNames}
            iconIndex={iconIndex}
            matchCount={filteredVets.length}
            total={veterans.length}
            onChange={setFilters}
            onClose={() => setFilterOpen(false)}
          />
        </div>
      )}
    </>
  );
}
