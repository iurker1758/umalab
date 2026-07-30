import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type ImportInfo, type Veteran } from "./api";
import { FilterPanel } from "./components/FilterPanel";
import { VeteranCard } from "./components/VeteranCard";
import { VeteranModal } from "./components/VeteranModal";
import {
  DEFAULT_ASC,
  SORTS,
  SORT_STORE,
  blueSparkRank,
  loadSortPref,
  type SortKey,
  type SortPref,
} from "./domain";
import {
  FILTER_STORE,
  countFilters,
  isCommonKind,
  loadFilters,
  matchesFilters,
  reconcileFilters,
  type Filters,
} from "./filters";

export default function App() {
  const [veterans, setVeterans] = useState<Veteran[]>([]);
  const [latest, setLatest] = useState<ImportInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState<SortPref>(loadSortPref);
  const [filters, setFilters] = useState<Filters>(loadFilters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [iconIndex, setIconIndex] = useState<Record<string, string>>({});
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [vets, imp] = await Promise.all([api.veterans(), api.latestImport()]);
      setVeterans(vets);
      setLatest(imp);
      setError(null);
      setFilters((prev) => reconcileFilters(prev, vets));
    } catch {
      setError("Can't reach the backend — is uvicorn running?");
    }
  }, []);

  useEffect(() => {
    // initial data load; the setState happens after the fetch resolves
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  useEffect(() => {
    // The icon index is a gitignored build product of scripts/fetch_icons.py
    // (DECISIONS.md #10) — a fresh clone legitimately has none, so any
    // failure just leaves every card on the initial-letter fallback.
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/icons/chara/index.json");
        if (!res.ok) return;
        const data: unknown = await res.json();
        if (!cancelled && data !== null && typeof data === "object") {
          setIconIndex(data as Record<string, string>);
        }
      } catch {
        // missing or non-JSON response — placeholders it is
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      await api.importDump(file);
      await refresh();
      setError(null);
    } catch (e) {
      setError(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const applySort = (next: SortPref) => {
    setSort(next);
    try {
      localStorage.setItem(SORT_STORE, JSON.stringify(next));
    } catch {
      // storage full/blocked — the choice still applies for this session
    }
  };

  // Persisted as an effect so every write path — panel edits AND the
  // reconciliation inside refresh() — lands in storage.
  useEffect(() => {
    try {
      localStorage.setItem(FILTER_STORE, JSON.stringify(filters));
    } catch {
      // storage full/blocked — the choice still applies for this session
    }
  }, [filters]);

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

  return (
    <div className="app">
      <header>
        <h1>UmaLab</h1>
        <div className="toolbar">
          <button onClick={() => fileInput.current?.click()} disabled={busy}>
            {busy ? "Importing…" : "Import data.json"}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          {latest && (
            <span className="import-info">
              {latest.veteran_count} veterans · imported{" "}
              {new Date(latest.imported_at).toLocaleString()}
            </span>
          )}
        </div>
      </header>

      {/* Fixed toast so it stays readable over the modal/picker backdrops —
          a mark-update failure used to vanish behind them. Click dismisses. */}
      {error && (
        <p className="error" role="alert" title="Dismiss" onClick={() => setError(null)}>
          {error}
        </p>
      )}

      {veterans.length === 0 ? (
        // With the backend unreachable the error toast is the whole story —
        // blaming the filters here sent people hunting through the panel.
        !error && (
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
              onOpen={() => setSelectedId(v.id)}
            />
          ))}
        </div>
      )}

      {veterans.length > 0 && (
        <div className="pill-dock">
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
          onChange={setFilters}
          onClose={() => setFilterOpen(false)}
        />
      )}

      {selected && (
        <VeteranModal
          v={selected}
          iconIndex={iconIndex}
          onClose={() => setSelectedId(null)}
          onChanged={refresh}
          onError={setError}
        />
      )}
    </div>
  );
}
