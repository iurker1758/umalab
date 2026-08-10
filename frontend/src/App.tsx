import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router";
import { api, type ImportInfo, type Veteran } from "./api";
import { emptyDesign, type Design } from "./blueprint";
import { loadFilters, reconcileFilters, saveFilters, type Filters } from "./filters";
import { DesignerPage } from "./pages/DesignerPage";
import { ListsPage } from "./pages/ListsPage";
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
  // The working design lives in the shell for the same reason filters do:
  // the page unmounts on every route change, and re-fetching the open
  // blueprint on every trip back from the roster would be pure churn.
  // Durability is the server's job now — DesignerPage opens (or creates) a
  // row on load and autosaves every edit. savedJson is the last-persisted
  // snapshot, which is how the page knows there's something to autosave.
  const [design, setDesign] = useState<Design>(emptyDesign);
  const [designSavedJson, setDesignSavedJson] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Roster-fetch failure, tracked apart from the shared toast: RosterPage
  // gates its "No roster yet" onboarding on it, and a designer error
  // writing the toast must not suppress that copy.
  const [fetchFailed, setFetchFailed] = useState(false);
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
      setFetchFailed(false);
      // Filters whose targets left the roster are cleared on every load
      // (see reconcileFilters).
      setFilters((prev) => reconcileFilters(prev, vets));
    } catch {
      setError("Can't reach the backend — is uvicorn running?");
      setFetchFailed(true);
    }
  }, []);

  // Persisted as an effect so every write path — panel edits AND the
  // refresh-time reconciliation — lands in storage.
  useEffect(() => {
    saveFilters(filters);
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
          <NavLink to="/lists">Lists</NavLink>
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
              hasError={fetchFailed}
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
          element={
            <DesignerPage
              veterans={veterans}
              iconIndex={iconIndex}
              design={design}
              setDesign={setDesign}
              savedJson={designSavedJson}
              setSavedJson={setDesignSavedJson}
              onError={setError}
            />
          }
        />
        <Route path="/lists" element={<ListsPage onError={setError} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
