import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router";
import { api, type ImportInfo, type Veteran } from "./api";
import { FILTER_STORE, loadFilters, reconcileFilters, type Filters } from "./filters";
import { RosterPage } from "./pages/RosterPage";

export default function App() {
  const [veterans, setVeterans] = useState<Veteran[]>([]);
  const [latest, setLatest] = useState<ImportInfo | null>(null);
  // Distinguishes "fetch hasn't succeeded yet" from a legitimately empty
  // roster — gates the "No roster yet" empty state so it can't flash at a
  // stocked roster's owner during the initial fetch.
  const [loaded, setLoaded] = useState(false);
  // Filters live in the shell, not RosterPage, so reconciliation stays tied
  // to the fetch — once per new roster. Page-local state would redo it on
  // every Roster remount, wiping selections that currently match nothing
  // (e.g. a favorite mark no veteran carries yet).
  const [filters, setFilters] = useState<Filters>(loadFilters);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [iconIndex, setIconIndex] = useState<Record<string, string>>({});
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [vets, imp] = await Promise.all([api.veterans(), api.latestImport()]);
      setVeterans(vets);
      setLatest(imp);
      setLoaded(true);
      setError(null);
      // Filters whose targets left the roster are cleared on every load
      // (see reconcileFilters).
      setFilters((prev) => reconcileFilters(prev, vets));
    } catch {
      setError("Can't reach the backend — is uvicorn running?");
    }
  }, []);

  // Persisted as an effect so every write path — panel edits AND the
  // refresh-time reconciliation — lands in storage.
  useEffect(() => {
    try {
      localStorage.setItem(FILTER_STORE, JSON.stringify(filters));
    } catch {
      // storage full/blocked — the choice still applies for this session
    }
  }, [filters]);

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
      // refresh() reports its own outcome: it clears the toast on success and
      // sets the backend-unreachable message on failure — an extra
      // setError(null) here would erase that report.
      await refresh();
    } catch (e) {
      setError(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <div className="app">
      <header>
        <h1>UmaLab</h1>
        <nav className="nav">
          <NavLink to="/" end>
            Roster
          </NavLink>
          <NavLink to="/designer">Designer</NavLink>
        </nav>
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

      <Routes>
        <Route
          path="/"
          element={
            <RosterPage
              veterans={veterans}
              loaded={loaded}
              hasError={error !== null}
              iconIndex={iconIndex}
              filters={filters}
              onFiltersChange={setFilters}
              onChanged={refresh}
              onError={setError}
            />
          }
        />
        <Route
          path="/designer"
          element={<p className="empty">The blueprint designer is coming soon.</p>}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
