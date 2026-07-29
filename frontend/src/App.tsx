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

type SortKey = "rank_score" | "blue_spark" | "register_time" | "name";

const SORTS: [label: string, key: SortKey][] = [
  ["Rating", "rank_score"],
  ["Sparks", "blue_spark"],
  ["Date Acquired", "register_time"],
  ["Name", "name"],
];

// Direction a key starts in when picked; the ▲/▼ toggle flips it from there.
const DEFAULT_ASC: Record<SortKey, boolean> = {
  rank_score: false, // best first
  blue_spark: true, // 1★ Speed → 3★ Wit
  register_time: false, // newest first
  name: true,
};

// "Sparks" orders by the veteran's own blue spark only: stat in game order,
// star within the stat — ascending runs 1★ Speed, 2★ Speed, … 3★ Wit.
const BLUE_ORDER = ["Speed", "Stamina", "Power", "Guts", "Wit"];
const blueSparkRank = (v: Veteran): number => {
  const blue = v.factors.find((f) => f.kind === "blue");
  if (!blue) return -1;
  const stat = BLUE_ORDER.indexOf(blue.name);
  // A degraded label (stale reference data) sorts before 1★ Speed.
  return stat === -1 ? -1 : stat * 3 + (blue.star - 1);
};

// Rating → rank-tier breakpoints (community-documented; the dump's own
// `rank` field is a raw id, not the displayed tier). First row whose
// minimum the score clears wins — note the U tiers sit above SS+.
const RANK_TIERS: [min: number, label: string][] = [
  [63400, "US"],
  [55200, "UA"],
  [47600, "UB"],
  [40700, "UC"],
  [34400, "UD"],
  [28800, "UE"],
  [23900, "UF"],
  [19600, "UG"],
  [19200, "SS+"],
  [17500, "SS"],
  [15900, "S+"],
  [14500, "S"],
  [12100, "A+"],
  [10000, "A"],
  [8200, "B+"],
  [6500, "B"],
  [4900, "C+"],
  [3500, "C"],
  [2900, "D+"],
  [2300, "D"],
  [1800, "E+"],
  [1300, "E"],
  [900, "F+"],
  [600, "F"],
  [300, "G+"],
  [0, "G"],
];
const rankTier = (score: number): string =>
  RANK_TIERS.find(([min]) => score >= min)?.[1] ?? "G";

// Card-strip labels for the own-spark display, matching the game's veteran
// list (WIT · MED · UNIQ …). Unmapped names (stale reference data) degrade
// to a five-letter uppercase clip instead of hiding the spark.
const SPARK_ABBR: Record<string, string> = {
  Speed: "SPD",
  Stamina: "STA",
  Power: "POW",
  Guts: "GUTS",
  Wit: "WIT",
  Turf: "TURF",
  Dirt: "DIRT",
  Sprint: "SPRINT",
  Mile: "MILE",
  Medium: "MED",
  Long: "LONG",
  "Front Runner": "FRONT",
  "Pace Chaser": "PACE",
  "Late Surger": "LATE",
  "End Closer": "END",
};
const sparkAbbr = (name: string) =>
  SPARK_ABBR[name] ?? name.slice(0, 5).toUpperCase();

type SortPref = { key: SortKey; asc: boolean };
const SORT_STORE = "umalab.sort";
const defaultSort: SortPref = { key: "register_time", asc: false };

function loadSortPref(): SortPref {
  try {
    const raw = localStorage.getItem(SORT_STORE);
    if (raw) {
      const p = JSON.parse(raw) as Partial<SortPref>;
      if (SORTS.some(([, k]) => k === p.key) && typeof p.asc === "boolean") {
        return p as SortPref;
      }
    }
  } catch {
    // unreadable storage or garbage value — fall through to the default
  }
  return defaultSort;
}

// The fixed set of assignable tag ids — must match backend/app/data/tag_icons.json.
// Art comes from `python scripts/extract_fav_icons.py` (gitignored); without it
// the <MarkIcon> fallback renders the mark number instead.
const MARK_IDS = Array.from({ length: 15 }, (_, i) => `mark_${String(i + 1).padStart(2, "0")}`);

// One 404 per mark id is enough — remember which ids lack art so later
// MarkIcon mounts go straight to the numbered fallback instead of re-firing
// the same requests on every modal open. Per-id, not a single flag: the
// extraction script can leave a partial set (sprites missing from the atlas
// are skipped with a warning), and one absent PNG must not suppress the rest.
const missingMarkArt = new Set<string>();

function MarkIcon({ id }: { id: string }) {
  const [failed, setFailed] = useState(missingMarkArt.has(id));
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
      onError={() => {
        missingMarkArt.add(id);
        setFailed(true);
      }}
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

function TagEditor({
  v,
  onChanged,
  onError,
}: {
  v: Veteran;
  onChanged: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  // Single-select: a veteran carries at most one mark. Clicking another mark
  // moves the selection (the backend replaces), clicking the active one clears.
  const current = v.tags[0];
  const pick = async (id: string) => {
    let failure: string | null = null;
    try {
      if (id === current) {
        await api.removeTag(v.trained_chara_id, id);
      } else {
        await api.addTag(v.trained_chara_id, id);
      }
    } catch (e) {
      failure = `Mark update failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    await onChanged(); // refresh even after a failure — it corrects stale state
    if (failure) onError(failure);
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

function VeteranDetail({
  v,
  onChanged,
  onError,
}: {
  v: Veteran;
  onChanged: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const parents = v.lineage.filter((m) => m.relation === "parent");
  const grandparentsOf = (parent: LineageMember) =>
    v.lineage.filter(
      (m) =>
        m.relation === "grandparent" &&
        Math.floor(m.position_id / 10) === parent.position_id / 10
    );

  return (
    <div className="detail">
      <TagEditor v={v} onChanged={onChanged} onError={onError} />
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

function SparkStrip({ v }: { v: Veteran }) {
  // One group per own blue/pink/unique spark, in that order — a veteran
  // without a unique simply shows two groups, like the game's list.
  const groups = (["blue", "pink", "unique"] as const)
    .map((kind) => v.factors.find((f) => f.kind === kind))
    .filter((f): f is Factor => f !== undefined);
  return (
    <span className="spark-strip">
      {groups.map((f) => (
        <span key={f.factor_id} className={`spark-group ${f.kind}`} title={`${f.name} ★${f.star}`}>
          <span className="spark-label">{f.kind === "unique" ? "UNIQ" : sparkAbbr(f.name)}</span>
          <span className="spark-stars">
            {[1, 2, 3].map((i) => (
              <span key={i} className={i <= f.star ? "star filled" : "star"}>
                ★
              </span>
            ))}
          </span>
        </span>
      ))}
    </span>
  );
}

function VeteranCard({
  v,
  icon,
  showSparks,
  onOpen,
}: {
  v: Veteran;
  icon: string | undefined;
  showSparks: boolean;
  onOpen: () => void;
}) {
  const [artFailed, setArtFailed] = useState(false);
  const title = `${v.name}${v.outfit && v.outfit !== "Original" ? ` (${v.outfit})` : ""}`;
  const tier = rankTier(v.rank_score);
  return (
    <button className="card" title={title} aria-label={title} onClick={onOpen}>
      <span className="card-art">
        {icon && !artFailed ? (
          <img
            src={`/icons/chara/${icon}`}
            alt=""
            loading="lazy"
            onError={() => setArtFailed(true)}
          />
        ) : (
          // Fresh clones have no icon art (gitignored; DECISIONS.md #10) and
          // new cards can be missing from a stale index — an initial tile
          // keeps the grid usable either way.
          <span className="card-fallback" aria-hidden="true">
            {v.name.charAt(0)}
          </span>
        )}
        {v.tags[0] && (
          <span className="card-badge">
            <MarkIcon id={v.tags[0]} />
          </span>
        )}
        <span
          className={`card-rank rank-${tier[0].toLowerCase()}`}
          title={`Rank ${tier} (${v.rank_score.toLocaleString()})`}
        >
          {tier}
        </span>
      </span>
      {showSparks ? (
        <SparkStrip v={v} />
      ) : (
        <span className="card-score">{v.rank_score.toLocaleString()}</span>
      )}
    </button>
  );
}

function VeteranModal({
  v,
  onClose,
  onChanged,
  onError,
}: {
  v: Veteran;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    // The backdrop scrolls instead of the page while the modal is open.
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const stats: [label: string, value: string | number][] = [
    ["Spd", v.speed],
    ["Sta", v.stamina],
    ["Pow", v.power],
    ["Guts", v.guts],
    ["Wit", v.wiz],
    ["Fans", v.fans.toLocaleString()],
    ["Wins", v.wins],
    ["Trained", v.register_time.slice(0, 10)],
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={v.name}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <h2>
            {v.name}
            {v.outfit && v.outfit !== "Original" ? (
              <span className="outfit"> {v.outfit}</span>
            ) : null}
            <span className="rarity"> ★{v.rarity}</span>
          </h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="stat-row">
          {stats.map(([label, value]) => (
            <span key={label}>
              <span className="stat-label">{label}</span>
              {value}
            </span>
          ))}
        </div>
        <VeteranDetail v={v} onChanged={onChanged} onError={onError} />
      </div>
    </div>
  );
}

export default function App() {
  const [veterans, setVeterans] = useState<Veteran[]>([]);
  const [latest, setLatest] = useState<ImportInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState<SortPref>(loadSortPref);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [iconIndex, setIconIndex] = useState<Record<string, string>>({});
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

  const sorted = useMemo(() => {
    const cards = [...veterans];
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
  }, [veterans, sort]);

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

      {error && <p className="error">{error}</p>}

      {veterans.length === 0 && !error ? (
        <p className="empty">
          No roster yet. Run UmaExtractor on the game's Veteran List screen, then import the
          <code> data.json</code> it produces.
        </p>
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
        <label className="sort-float">
          Sort
          <select
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
      )}

      {selected && (
        <VeteranModal
          v={selected}
          onClose={() => setSelectedId(null)}
          onChanged={refresh}
          onError={setError}
        />
      )}
    </div>
  );
}
