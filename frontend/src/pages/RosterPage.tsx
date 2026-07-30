import { useEffect, useMemo, useState } from "react";
import { api, type Veteran } from "../api";
import { FilterPanel } from "../components/FilterPanel";
import { MarkIcon } from "../components/MarkIcon";
import { MarkPicker } from "../components/MarkPicker";
import { VeteranCard } from "../components/VeteranCard";
import { VeteranModal } from "../components/VeteranModal";
import {
  DEFAULT_ASC,
  SORTS,
  SORT_STORE,
  blueSparkRank,
  loadSortPref,
  type SortKey,
  type SortPref,
} from "../domain";
import { countFilters, isCommonKind, matchesFilters, type Filters } from "../filters";

export function RosterPage({
  veterans,
  loaded,
  hasError,
  iconIndex,
  filters,
  onFiltersChange,
  onChanged,
  onError,
}: {
  veterans: Veteran[];
  loaded: boolean;
  hasError: boolean;
  iconIndex: Record<string, string>;
  filters: Filters;
  onFiltersChange: (f: Filters) => void;
  onChanged: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [sort, setSort] = useState<SortPref>(loadSortPref);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // Batch Favorite, in the game's own order: pick the target first (a mark,
  // or ✕ for clear mode), then select veterans, then Confirm. undefined =
  // not selecting; null = clear mode; a mark id = apply mode. The selection
  // is keyed by trained_chara_id (the tag API's key), not veterans.id, and
  // is page-local on purpose: leaving the roster abandons it like it
  // abandons an open modal.
  const [bulkTarget, setBulkTarget] = useState<string | null | undefined>(undefined);
  const [targetPickerOpen, setTargetPickerOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const selecting = bulkTarget !== undefined;

  // Eligible = the confirm would change this veteran: it doesn't already
  // carry the target mark (any other mark gets replaced), or in clear mode
  // it carries something to clear. Ineligible cards render inert.
  const isEligible = (v: Veteran) =>
    bulkTarget === null ? v.tags.length > 0 : v.tags[0] !== bulkTarget;

  const applySort = (next: SortPref) => {
    setSort(next);
    try {
      localStorage.setItem(SORT_STORE, JSON.stringify(next));
    } catch {
      // storage full/blocked — the choice still applies while the roster
      // stays mounted (navigating away discards page state)
    }
  };

  // One entry per distinct card in the roster, for the Umas filter section.
  const rosterCards = useMemo(() => {
    const seen = new Map<number, Veteran>();
    for (const v of veterans) {
      if (!seen.has(v.card_id)) seen.set(v.card_id, v);
    }
    return [...seen.values()].sort(
      (a, b) => a.name.localeCompare(b.name) || a.card_id - b.card_id
    );
  }, [veterans]);

  // Every common-spark (white skill / race / scenario) name present anywhere
  // in the roster (own + lineage) — the searchable vocabulary for the filter.
  const commonSparkNames = useMemo(() => {
    const names = new Set<string>();
    for (const v of veterans) {
      for (const f of v.factors) if (isCommonKind(f.kind)) names.add(f.name);
      for (const m of v.lineage) {
        for (const f of m.factors) if (isCommonKind(f.kind)) names.add(f.name);
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [veterans]);

  const sorted = useMemo(() => {
    const cards = veterans.filter((v) => matchesFilters(v, filters));
    const val = (v: Veteran) =>
      sort.key === "blue_spark" ? blueSparkRank(v) : v[sort.key];
    cards.sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      // register_time is ISO, so string compare doubles as date order.
      const cmp =
        typeof av === "string" && typeof bv === "string"
          ? av.localeCompare(bv)
          : Number(av) - Number(bv);
      return sort.asc ? cmp : -cmp;
    });
    return cards;
  }, [veterans, sort, filters]);

  // Derived from the roster, not stored: a refresh (tag edit, re-import)
  // updates the open modal in place, and an import that drops the veteran
  // closes it instead of showing stale data.
  const selected = veterans.find((v) => v.id === selectedId);

  // The selection that actually counts (and gets confirmed) is its overlap
  // with the current filter view AND eligibility — derived, so tightening
  // the filters makes hidden picks inert instead of silently marking
  // off-screen cards (loosening brings them back), and a pick that became
  // ineligible under a refreshed roster drops out rather than re-applying.
  const visibleSelected = useMemo(
    () => sorted.filter((v) => selectedIds.has(v.trained_chara_id) && isEligible(v)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isEligible only reads bulkTarget
    [sorted, selectedIds, bulkTarget]
  );

  const exitSelectMode = () => {
    setBulkTarget(undefined);
    setSelectedIds(new Set());
    setTargetPickerOpen(false);
  };

  const toggleSelected = (trainedCharaId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (!next.delete(trainedCharaId)) next.add(trainedCharaId);
      return next;
    });
  };

  // Escape backs out one layer at a time, matching the modal's convention:
  // first the target picker, then selection mode itself. While the filter
  // panel is open it owns Escape (it has its own layered handler); and while
  // the confirm is in flight nothing backs out — the selection must still be
  // there for the failure path's retry.
  useEffect(() => {
    if (!selecting && !targetPickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || filterOpen || bulkBusy) return;
      if (targetPickerOpen) {
        setTargetPickerOpen(false);
      } else {
        setBulkTarget(undefined);
        setSelectedIds(new Set());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting, targetPickerOpen, filterOpen, bulkBusy]);

  // Confirm the batch: apply the target mark to (or, in clear mode, clear)
  // every visible selected veteran. Mirrors the modal's pickMark: refresh
  // even after a failure — it corrects stale state — and only report after.
  const confirmBulk = async () => {
    if (bulkTarget === undefined || visibleSelected.length === 0) return;
    setBulkBusy(true);
    let failure: string | null = null;
    try {
      await api.bulkTag(
        visibleSelected.map((v) => v.trained_chara_id),
        bulkTarget
      );
    } catch (e) {
      failure = `Bulk mark update failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    await onChanged();
    setBulkBusy(false);
    if (failure) {
      // Keep the mode and selection so the user can retry; the refresh
      // above already pruned picks that left the roster or became
      // ineligible.
      onError(failure);
    } else {
      exitSelectMode();
    }
  };

  return (
    <>
      {veterans.length > 0 && (
        // Batch Favorite lives apart from the Filters/sort dock: a sticky
        // row at the roster's top right, so Cancel/Confirm stay reachable
        // however far the grid has scrolled.
        <div className={selecting ? "batch-dock select-dock" : "batch-dock"}>
          {selecting ? (
            <>
              {/* Reading order: what's being applied and to how many, then
                  the selection tools, then the abort/commit pair at the
                  prominent right edge (dialog convention). Everything except
                  Confirm freezes while the request is in flight — Cancel
                  can't pretend to back out a request that's already on the
                  wire, and All/None would desync the sent payload from what
                  the dock shows. */}
              <span
                className="select-count target-chip"
                title={bulkTarget ? "Batch-applying this mark" : "Batch-clearing marks"}
              >
                {bulkTarget ? (
                  <MarkIcon id={bulkTarget} />
                ) : (
                  <span className="mark-none" aria-hidden="true">
                    ✕
                  </span>
                )}
              </span>
              <span className="select-count" role="status">
                {visibleSelected.length} selected
              </span>
              <button
                className="filter-float"
                disabled={bulkBusy}
                onClick={() =>
                  setSelectedIds(
                    new Set(sorted.filter(isEligible).map((v) => v.trained_chara_id))
                  )
                }
              >
                All
              </button>
              <button
                className="filter-float"
                disabled={bulkBusy}
                onClick={() => setSelectedIds(new Set())}
              >
                None
              </button>
              <button className="filter-float" disabled={bulkBusy} onClick={exitSelectMode}>
                Cancel
              </button>
              <button
                className="filter-float"
                disabled={visibleSelected.length === 0 || bulkBusy}
                onClick={() => void confirmBulk()}
              >
                {bulkBusy ? "Applying…" : "Confirm"}
              </button>
            </>
          ) : (
            <span className="bulk-mark-anchor">
              <button
                className="filter-float"
                aria-expanded={targetPickerOpen}
                onClick={() => setTargetPickerOpen(!targetPickerOpen)}
              >
                Batch Favorite
              </button>
              {targetPickerOpen && (
                // Game-order flow: the mark comes first. ✕ enters clear mode.
                <MarkPicker
                  activeId={undefined}
                  caption="Pick a mark, then select veterans"
                  clearTitle="Clear marks"
                  tileTitle="Batch apply"
                  activeTileTitle="Batch apply"
                  popupClassName="mark-popup dock-popup"
                  ariaLabel="Choose mark to batch apply"
                  onPick={(id) => {
                    setTargetPickerOpen(false);
                    setBulkTarget(id);
                  }}
                  onClose={() => setTargetPickerOpen(false)}
                />
              )}
            </span>
          )}
        </div>
      )}

      {veterans.length === 0 ? (
        // Gated on `loaded` so the initial fetch renders nothing here — a
        // stocked roster's owner shouldn't be told to go run the extractor
        // while the request is in flight. With the backend unreachable the
        // error toast is the whole story — blaming the filters here sent
        // people hunting through the panel.
        loaded &&
        !hasError && (
          <p className="empty">
            No roster yet. Run UmaExtractor on the game's Veteran List screen, then import the
            <code> data.json</code> it produces.
          </p>
        )
      ) : sorted.length === 0 ? (
        <p className="empty">No veterans match the filters.</p>
      ) : (
        <div className="grid">
          {sorted.map((v) => (
            <VeteranCard
              key={v.id}
              v={v}
              icon={iconIndex[String(v.card_id)]}
              showSparks={sort.key === "blue_spark"}
              selectMode={selecting}
              selectDisabled={selecting && !isEligible(v)}
              selected={
                selecting && isEligible(v) && selectedIds.has(v.trained_chara_id)
              }
              onOpen={() => {
                // Frozen while the confirm is in flight: a pick made now
                // would silently miss the already-sent request. Ineligible
                // cards (already carrying the target) never toggle.
                if (selecting) {
                  if (!bulkBusy && isEligible(v)) toggleSelected(v.trained_chara_id);
                } else {
                  setSelectedId(v.id);
                }
              }}
            />
          ))}
        </div>
      )}

      {veterans.length > 0 && (
        <div className="pill-dock">
          {/* Filters and sort keep their own dock, live through selection
              mode too: hidden picks go inert via the visibleSelected
              overlap, and the badge keeps an active filter from silently
              narrowing what the batch dock's "All" means. */}
          <button className="filter-float" onClick={() => setFilterOpen(true)}>
            Filters
            {countFilters(filters) > 0 && (
              <span className="filter-count">{countFilters(filters)}</span>
            )}
          </button>
          <label className="sort-float">
            <select
              aria-label="Sort by"
              value={sort.key}
              onChange={(e) => {
                const key = e.target.value as SortKey;
                applySort({ key, asc: DEFAULT_ASC[key] });
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
              aria-label={sort.asc ? "Sort ascending" : "Sort descending"}
              onClick={() => applySort({ ...sort, asc: !sort.asc })}
            >
              {sort.asc ? "▲" : "▼"}
            </button>
          </label>
        </div>
      )}

      {filterOpen && (
        <FilterPanel
          filters={filters}
          cards={rosterCards}
          whiteNames={commonSparkNames}
          iconIndex={iconIndex}
          matchCount={sorted.length}
          total={veterans.length}
          onChange={onFiltersChange}
          onClose={() => setFilterOpen(false)}
        />
      )}

      {selected && (
        <VeteranModal
          v={selected}
          iconIndex={iconIndex}
          onClose={() => setSelectedId(null)}
          onChanged={onChanged}
          onError={onError}
        />
      )}
    </>
  );
}
