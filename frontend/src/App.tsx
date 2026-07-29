import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Factor, type ImportInfo, type LineageMember, type Veteran } from "./api";

// Aptitude ints 1..8 map to letters G..S (verified: pink sparks gate on >= 7 = A).
const APT = "-GFEDCBAS";
const apt = (n: number) => APT[n] ?? "?";

const APTITUDES: [label: string, key: keyof Veteran][] = [
  ["Turf", "proper_ground_turf"],
  ["Dirt", "proper_ground_dirt"],
  ["Short", "proper_distance_short"],
  ["Mile", "proper_distance_mile"],
  ["Medium", "proper_distance_middle"],
  ["Long", "proper_distance_long"],
  ["Front", "proper_running_style_nige"],
  ["Pace", "proper_running_style_senko"],
  ["Late", "proper_running_style_sashi"],
  ["End", "proper_running_style_oikomi"],
];

type SortKey =
  | "name"
  | "rank_score"
  | "speed"
  | "stamina"
  | "power"
  | "guts"
  | "wiz"
  | "fans"
  | "wins"
  | "register_time";

const COLUMNS: [label: string, key: SortKey][] = [
  ["Uma", "name"],
  ["Score", "rank_score"],
  ["Spd", "speed"],
  ["Sta", "stamina"],
  ["Pow", "power"],
  ["Guts", "guts"],
  ["Wit", "wiz"],
  ["Fans", "fans"],
  ["Wins", "wins"],
  ["Trained", "register_time"],
];

// The fixed set of assignable tag ids — must match backend/app/data/tag_icons.json.
// Art comes from `python scripts/extract_fav_icons.py` (gitignored); without it
// the <MarkIcon> fallback renders the mark number instead.
const MARK_IDS = Array.from({ length: 15 }, (_, i) => `mark_${String(i + 1).padStart(2, "0")}`);

function MarkIcon({ id }: { id: string }) {
  const [failed, setFailed] = useState(false);
  const label = `Mark ${Number(id.slice(-2))}`;
  return failed ? (
    <span className="mark-fallback" title={label}>
      {Number(id.slice(-2))}
    </span>
  ) : (
    <img
      className="mark-icon"
      src={`/icons/marks/${id}.png`}
      alt={label}
      title={label}
      onError={() => setFailed(true)}
    />
  );
}

function FactorChips({ factors }: { factors: Factor[] }) {
  return (
    <span className="chips">
      {factors.map((f) => (
        <span key={f.factor_id} className={`chip ${f.kind}`} title={`${f.kind} factor`}>
          {f.name} ★{f.star}
        </span>
      ))}
    </span>
  );
}

function LineageSlot({ member, label }: { member: LineageMember; label: string }) {
  return (
    <div className="lineage-slot">
      <div className="lineage-title">
        <span className="lineage-label">{label}</span> {member.name}
        {member.outfit && member.outfit !== "Original" ? ` (${member.outfit})` : ""}
      </div>
      <FactorChips factors={member.factors} />
    </div>
  );
}

function TagEditor({ v, onChanged }: { v: Veteran; onChanged: () => Promise<void> }) {
  // Single-select: a veteran carries at most one mark. Clicking another mark
  // moves the selection (the backend replaces), clicking the active one clears.
  const current = v.tags[0];
  const pick = async (id: string) => {
    if (id === current) {
      await api.removeTag(v.trained_chara_id, id);
    } else {
      await api.addTag(v.trained_chara_id, id);
    }
    await onChanged();
  };

  return (
    <div className="mark-row">
      {MARK_IDS.map((id) => (
        <button
          key={id}
          className={id === current ? "mark-toggle active" : "mark-toggle"}
          title={id === current ? "Remove mark" : "Set mark"}
          onClick={() => void pick(id)}
        >
          <MarkIcon id={id} />
        </button>
      ))}
    </div>
  );
}

function VeteranDetail({ v, onChanged }: { v: Veteran; onChanged: () => Promise<void> }) {
  const parents = v.lineage.filter((m) => m.relation === "parent");
  const grandparentsOf = (parent: LineageMember) =>
    v.lineage.filter(
      (m) =>
        m.relation === "grandparent" &&
        Math.floor(m.position_id / 10) === parent.position_id / 10
    );

  return (
    <div className="detail">
      <TagEditor v={v} onChanged={onChanged} />
      <div className="apt-grid">
        {APTITUDES.map(([label, key]) => (
          <span key={key} className="apt">
            <span className="apt-label">{label}</span> {apt(v[key] as number)}
          </span>
        ))}
      </div>
      <div className="detail-section">
        <div className="detail-heading">Own sparks</div>
        <FactorChips factors={v.factors} />
      </div>
      {parents.map((parent, i) => (
        <div key={parent.position_id} className="detail-section">
          <LineageSlot member={parent} label={`Parent ${i + 1}`} />
          {grandparentsOf(parent).map((gp, j) => (
            <LineageSlot key={gp.position_id} member={gp} label={`Grandparent ${i + 1}.${j + 1}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [veterans, setVeterans] = useState<Veteran[]>([]);
  const [latest, setLatest] = useState<ImportInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("rank_score");
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [tagFilter, setTagFilter] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [vets, imp] = await Promise.all([api.veterans(), api.latestImport()]);
      setVeterans(vets);
      setLatest(imp);
      setError(null);
    } catch {
      setError("Can't reach the backend — is uvicorn running?");
    }
  }, []);

  useEffect(() => {
    // initial data load; the setState happens after the fetch resolves
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

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

  const onSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === "name"); // text ascending, numbers descending by default
    }
  };

  const usedMarks = useMemo(
    () => [...new Set(veterans.flatMap((v) => v.tags))].sort(),
    [veterans]
  );
  // A stale filter (its last carrier untagged or gone) must not strand the
  // roster on an empty view with no visible control.
  const effectiveFilter = usedMarks.includes(tagFilter) ? tagFilter : "";

  const sorted = useMemo(() => {
    const rows = effectiveFilter
      ? veterans.filter((v) => v.tags.includes(effectiveFilter))
      : [...veterans];
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp =
        typeof av === "string" && typeof bv === "string"
          ? av.localeCompare(bv)
          : Number(av) - Number(bv);
      return sortAsc ? cmp : -cmp;
    });
    return rows;
  }, [veterans, sortKey, sortAsc, effectiveFilter]);

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
          {usedMarks.length > 0 && (
            <div className="mark-row">
              {usedMarks.map((id) => (
                <button
                  key={id}
                  className={effectiveFilter === id ? "mark-toggle active" : "mark-toggle"}
                  title={effectiveFilter === id ? "Show all" : "Filter by mark"}
                  onClick={() => setTagFilter(effectiveFilter === id ? "" : id)}
                >
                  <MarkIcon id={id} />
                </button>
              ))}
            </div>
          )}
          {latest && (
            <span className="import-info">
              {latest.veteran_count} veterans · imported{" "}
              {new Date(latest.imported_at).toLocaleString()}
            </span>
          )}
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      {veterans.length === 0 && !error ? (
        <p className="empty">
          No roster yet. Run UmaExtractor on the game's Veteran List screen, then import the
          <code> data.json</code> it produces.
        </p>
      ) : (
        <table className="roster">
          <thead>
            <tr>
              {COLUMNS.map(([label, key]) => (
                <th key={key} onClick={() => onSort(key)}>
                  {label}
                  {sortKey === key ? (sortAsc ? " ▲" : " ▼") : ""}
                </th>
              ))}
              <th>Apt</th>
              <th>Tags</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((v) => (
              <VeteranRow
                key={v.id}
                v={v}
                expanded={expandedId === v.id}
                onToggle={() => setExpandedId(expandedId === v.id ? null : v.id)}
                onChanged={refresh}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function VeteranRow({
  v,
  expanded,
  onToggle,
  onChanged,
}: {
  v: Veteran;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => Promise<void>;
}) {
  return (
    <>
      <tr className={expanded ? "row expanded" : "row"} onClick={onToggle}>
        <td className="name-cell">
          {v.name}
          {v.outfit && v.outfit !== "Original" ? <span className="outfit"> {v.outfit}</span> : null}
          <span className="rarity"> ★{v.rarity}</span>
        </td>
        <td>{v.rank_score.toLocaleString()}</td>
        <td>{v.speed}</td>
        <td>{v.stamina}</td>
        <td>{v.power}</td>
        <td>{v.guts}</td>
        <td>{v.wiz}</td>
        <td>{v.fans.toLocaleString()}</td>
        <td>{v.wins}</td>
        <td className="trained-cell">{v.register_time.slice(0, 10)}</td>
        <td className="apt-cell">
          T{apt(v.proper_ground_turf)} D{apt(v.proper_ground_dirt)}
        </td>
        <td>
          <span className="mark-badges">
            {v.tags.map((id) => (
              <MarkIcon key={id} id={id} />
            ))}
          </span>
        </td>
      </tr>
      {expanded && (
        <tr className="detail-row">
          <td colSpan={COLUMNS.length + 2}>
            <VeteranDetail v={v} onChanged={onChanged} />
          </td>
        </tr>
      )}
    </>
  );
}
