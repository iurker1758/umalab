import { useEffect, useMemo, useState } from "react";
import { api, type Veteran } from "../api";
import { FilterPanel } from "../components/FilterPanel";
import { MarkIcon } from "../components/MarkIcon";
import { VeteranCard } from "../components/VeteranCard";
import { VeteranModal } from "../components/VeteranModal";
import {
  DEFAULT_ASC,
  MARK_IDS,
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
  // Selection mode for bulk marking. Keyed by trained_chara_id (the tag
  // API's key), not veterans.id. Page-local on purpose: leaving the roster
  // abandons the selection like it abandons an open modal.
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(new Set());
  const [bulkMarkOpen, setBulkMarkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

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

  // The selection that actually counts (and gets marked) is its overlap
  // with the current filter view — derived, so tightening the filters
  // makes hidden picks inert instead of silently marking off-screen cards,
  // and loosening them brings the picks back.
  const visibleSelected = useMemo(
    () => sorted.filter((v) => selectedIds.has(v.trained_chara_id)),
    [sorted, selectedIds]
  );

  const exitSelectMode = () => {
    setSelecting(false);
    setSelectedIds(new Set());
    setBulkMarkOpen(false);
  };

  const toggleSelected = (trainedCharaId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (!next.delete(trainedCharaId)) next.add(trainedCharaId);
      return next;
    });
  };

  // Escape backs out one layer at a time, matching the modal's convention:
  // first the mark popup, then selection mode itself.
  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (bulkMarkOpen) {
        setBulkMarkOpen(false);
      } else {
        setSelecting(false);
        setSelectedIds(new Set());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting, bulkMarkOpen]);

  // Apply one mark to (tag) or clear the marks of (null) every visible
  // selected veteran. Mirrors the modal's pickMark: refresh even after a
  // failure — it corrects stale state — and only report the error after.
  const applyBulk = async (tag: string | null) => {
    setBulkMarkOpen(false);
    if (visibleSelected.length === 0) return;
    setBulkBusy(true);
    let failure: string | null = null;
    try {
      await api.bulkTag(
        visibleSelected.map((v) => v.trained_chara_id),
        tag
      );
    } catch (e) {
      failure = `Bulk mark update failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    await onChanged();
    setBulkBusy(false);
    if (failure) {
      // Keep the mode and selection so the user can retry; the refresh
      // above already pruned picks that left the roster.
      onError(failure);
    } else {
      exitSelectMode();
    }
  };

  return (
    <>
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
              selected={selecting && selectedIds.has(v.trained_chara_id)}
              onOpen={() =>
                selecting ? toggleSelected(v.trained_chara_id) : setSelectedId(v.id)
              }
            />
          ))}
        </div>
      )}

      {veterans.length > 0 && selecting && (
        <div className="pill-dock select-dock">
          <button className="filter-float" onClick={exitSelectMode}>
            Cancel
          </button>
          <span className="select-count" role="status">
            {visibleSelected.length} selected
          </span>
          <button
            className="filter-float"
            onClick={() =>
              setSelectedIds(new Set(sorted.map((v) => v.trained_chara_id)))
            }
          >
            All
          </button>
          <button className="filter-float" onClick={() => setSelectedIds(new Set())}>
            None
          </button>
          <span className="bulk-mark-anchor">
            <button
              className="filter-float"
              disabled={visibleSelected.length === 0 || bulkBusy}
              aria-expanded={bulkMarkOpen}
              onClick={() => setBulkMarkOpen(!bulkMarkOpen)}
            >
              {bulkBusy ? "Applying…" : "Mark"}
            </button>
            {bulkMarkOpen && (
              <>
                <span
                  className="mark-popup-backdrop"
                  onMouseDown={() => setBulkMarkOpen(false)}
                />
                {/* Same 4×4 grid as the modal's picker; here the leading ✕
                    means "clear the selection's marks", not deselect. */}
                <span className="mark-popup dock-popup" role="dialog" aria-label="Apply mark">
                  <button
                    className="mark-toggle mark-clear"
                    title="Clear marks"
                    aria-label="Clear marks"
                    onClick={() => void applyBulk(null)}
                  >
                    <span className="mark-none" aria-hidden="true">
                      ✕
                    </span>
                  </button>
                  {MARK_IDS.map((id) => (
                    <button
                      key={id}
                      className="mark-toggle"
                      title="Apply mark"
                      onClick={() => void applyBulk(id)}
                    >
                      <MarkIcon id={id} />
                    </button>
                  ))}
                </span>
              </>
            )}
          </span>
        </div>
      )}

      {veterans.length > 0 && !selecting && (
        <div className="pill-dock">
          <button className="filter-float" onClick={() => setSelecting(true)}>
            Select
          </button>
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
