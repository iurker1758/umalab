import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router";
import { ApiError, api, onSessionExpired, type ImportInfo, type Me, type Veteran } from "./api";
import { emptyDesign, type Design } from "./blueprint";
import { loadFilters, reconcileFilters, saveFilters, type Filters } from "./filters";
import { DesignerPage } from "./pages/DesignerPage";
import { ListsPage } from "./pages/ListsPage";
import { RosterPage } from "./pages/RosterPage";
import { SignInPage } from "./pages/SignInPage";

export default function App() {
  // undefined until /api/auth/me answers; null is nobody signed in, which
  // renders the Sign In screen in place of the whole app. Nothing else is
  // fetched before this resolves, so a startup 401 can never read as an
  // expired session.
  const [me, setMe] = useState<Me | null | undefined>(undefined);
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
  // Latched by any /api request answered 401 once signed in (issue #113).
  // Re-throws while the overlay is up just re-latch it; the only way down
  // is a probe the backend answers with something other than a 401.
  const [sessionExpired, setSessionExpired] = useState(false);
  const [checking, setChecking] = useState(false);
  const probing = useRef(false);

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

  useEffect(() => onSessionExpired(() => setSessionExpired(true)), []);

  // The cheapest read in the API, and not refresh(): its catch would churn
  // the toast and the roster-onboarding gate on every failed probe. The
  // overlay stands down only on proof the session is whole — a success, or
  // an ApiError carrying a real HTTP status; a fresh 401 throws
  // SessionExpired and leaves it up. A rejected fetch (network down)
  // reached nothing and proves nothing: standing down on it would drop the
  // user into an app where every request fails. Whatever the toast held
  // stays held — refresh()'s own lifecycle governs it from here.
  const probeSession = useCallback(() => {
    if (probing.current) return;
    probing.current = true;
    setChecking(true);
    void (async () => {
      const recovered = () => {
        setSessionExpired(false);
        void refresh();
      };
      try {
        await api.latestImport();
        recovered();
      } catch (e) {
        if (e instanceof ApiError) recovered();
      } finally {
        probing.current = false;
        setChecking(false);
      }
    })();
  }, [refresh]);

  // Coming back from the sign-in tab is the natural moment the session is
  // whole again, so returning focus doubles as the Retry.
  useEffect(() => {
    if (!sessionExpired) return;
    const onReturn = () => {
      if (document.visibilityState === "visible") probeSession();
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [sessionExpired, probeSession]);

  // Persisted as an effect so every write path — panel edits AND the
  // refresh-time reconciliation — lands in storage.
  useEffect(() => {
    saveFilters(filters);
  }, [filters]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const who = await api.me();
        if (!cancelled) setMe(who);
      } catch {
        if (!cancelled) setError("Can't reach the backend — is uvicorn running?");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // initial data load, once someone is signed in; the setState happens
    // after the fetch resolves
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (me) void refresh();
  }, [me, refresh]);

  const signOut = async () => {
    try {
      await api.logout();
    } catch (e) {
      setError(`Sign out failed: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    // No state reset beyond this: the Sign In screen replaces the whole
    // app, and signing back in is a full navigation through Discord.
    setMe(null);
  };

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

  if (me === undefined) {
    return (
      <div className="app">
        <header>
          <h1>UmaLab</h1>
        </header>
        {error && (
          <p className="error" role="alert" title="Dismiss" onClick={() => setError(null)}>
            {error}
          </p>
        )}
      </div>
    );
  }

  if (me === null) {
    return (
      <div className="app">
        <header>
          <h1>UmaLab</h1>
        </header>
        <Routes>
          <Route path="/signin" element={<SignInPage />} />
          <Route path="*" element={<Navigate to="/signin" replace />} />
        </Routes>
      </div>
    );
  }

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
          <span className="who">
            {me.name}
            <button className="signout" onClick={() => void signOut()}>
              Sign Out
            </button>
          </span>
        </div>
      </header>

      {/* Fixed toast so it stays readable over the modal/picker backdrops —
          a mark-update failure used to vanish behind them. Click dismisses.
          Gated while the session overlay is up: every failure then is the
          same expired session, and the overlay is the one report. */}
      {error && !sessionExpired && (
        <p className="error" role="alert" title="Dismiss" onClick={() => setError(null)}>
          {error}
        </p>
      )}

      {/* No dismissal — closing it would drop the user into an app where
          every request fails. The Sign In target is a relative /api path:
          nothing deployment-specific in the repo, and top-level navigations
          to /api reach the backend (and so the Discord login) only because
          of the navigateFallbackDenylist in vite.config.ts — keep them in
          sync. */}
      {sessionExpired && (
        <div className="session-backdrop">
          <div className="session-dialog" role="dialog" aria-modal="true" aria-labelledby="session-title">
            <h2 id="session-title">Session Expired</h2>
            <p>Your login session has expired. Sign in again in a new tab, then come back here.</p>
            <p>After signing in, close that tab and come back.</p>
            <div className="session-actions">
              <button onClick={() => window.open("/api/auth/login", "_blank")}>Sign In</button>
              <button className="session-retry" onClick={probeSession} disabled={checking}>
                {checking ? "Checking…" : "Retry"}
              </button>
            </div>
          </div>
        </div>
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
        {/* Signed in already — a stale sign-in tab or a bookmarked refusal. */}
        <Route path="/signin" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
