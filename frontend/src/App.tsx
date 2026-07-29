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

function VeteranDetail({ v }: { v: Veteran }) {
  const parents = v.lineage.filter((m) => m.relation === "parent");
  const grandparentsOf = (parent: LineageMember) =>
    v.lineage.filter(
      (m) =>
        m.relation === "grandparent" &&
        Math.floor(m.position_id / 10) === parent.position_id / 10
    );

  return (
    <div className="detail">
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

  const sorted = useMemo(() => {
    const rows = [...veterans];
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
  }, [veterans, sortKey, sortAsc]);

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
            </tr>
          </thead>
          <tbody>
            {sorted.map((v) => (
              <VeteranRow
                key={v.id}
                v={v}
                expanded={expandedId === v.id}
                onToggle={() => setExpandedId(expandedId === v.id ? null : v.id)}
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
}: {
  v: Veteran;
  expanded: boolean;
  onToggle: () => void;
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
      </tr>
      {expanded && (
        <tr className="detail-row">
          <td colSpan={COLUMNS.length + 1}>
            <VeteranDetail v={v} />
          </td>
        </tr>
      )}
    </>
  );
}
