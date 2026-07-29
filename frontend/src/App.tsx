import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type Factor,
  type ImportInfo,
  type LineageMember,
  type Skill,
  type Veteran,
} from "./api";

// Aptitude ints 1..8 map to letters G..S (verified: pink sparks gate on >= 7 = A).
const APT = "-GFEDCBAS";
const apt = (n: number) => APT[n] ?? "?";

// Aptitudes grouped the way the game's detail screen shows them.
const APT_GROUPS: [group: string, apts: [label: string, key: keyof Veteran][]][] = [
  [
    "Track",
    [
      ["Turf", "proper_ground_turf"],
      ["Dirt", "proper_ground_dirt"],
    ],
  ],
  [
    "Distance",
    [
      ["Sprint", "proper_distance_short"],
      ["Mile", "proper_distance_mile"],
      ["Medium", "proper_distance_middle"],
      ["Long", "proper_distance_long"],
    ],
  ],
  [
    "Style",
    [
      ["Front", "proper_running_style_nige"],
      ["Pace", "proper_running_style_senko"],
      ["Late", "proper_running_style_sashi"],
      ["End", "proper_running_style_oikomi"],
    ],
  ],
];

// Stat value → grade letter, verified against in-game veteran screens
// (1200→SS+, 1110→SS, 612→B, 488→C): 50-wide up to D+, 100-wide C..A+,
// 50-wide S..SS+, with SS+ ending at exactly 1200. Above that the uncap
// ladder runs in 100-wide bands from UG at 1201 — anchors confirmed
// in-game at 1201→UG, 1317→UF, 1613→UC.
const STAT_GRADES: [min: number, label: string][] = [
  [1901, "US"],
  [1801, "UA"],
  [1701, "UB"],
  [1601, "UC"],
  [1501, "UD"],
  [1401, "UE"],
  [1301, "UF"],
  [1201, "UG"],
  [1150, "SS+"],
  [1100, "SS"],
  [1050, "S+"],
  [1000, "S"],
  [900, "A+"],
  [800, "A"],
  [700, "B+"],
  [600, "B"],
  [500, "C+"],
  [400, "C"],
  [350, "D+"],
  [300, "D"],
  [250, "E+"],
  [200, "E"],
  [150, "F+"],
  [100, "F"],
  [50, "G+"],
  [0, "G"],
];
const statGrade = (n: number): string =>
  STAT_GRADES.find(([min]) => n >= min)?.[1] ?? "G";

// Letter → color-family class, shared by stat grades and aptitude letters
// (SS/S gold, A orange, … G gray — same palette as the rank badges).
const gradeClass = (letter: string): string =>
  "sabcdefgu".includes(letter[0]?.toLowerCase() ?? "")
    ? `ltr-${letter[0].toLowerCase()}`
    : "";

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

// ---------- filtering ----------
// OR within a category, AND across categories: each section you touch
// narrows the grid, untouched sections don't filter at all.

// Pink spark chips: short label → the factor name in the data.
const PINK_SPARKS: [label: string, name: string][] = [
  ["Turf", "Turf"],
  ["Dirt", "Dirt"],
  ["Sprint", "Sprint"],
  ["Mile", "Mile"],
  ["Medium", "Medium"],
  ["Long", "Long"],
  ["Front", "Front Runner"],
  ["Pace", "Pace Chaser"],
  ["Late", "Late Surger"],
  ["End", "End Closer"],
];

type StarMode = "all" | "2plus" | "3";
type SparkFilter = { names: string[]; stars: StarMode; legacy: boolean };
type Filters = {
  blue: SparkFilter;
  pink: SparkFilter;
  unique: { stars: number[]; legacy: boolean };
  marks: string[];
  cards: number[];
};

const defaultFilters: Filters = {
  blue: { names: [], stars: "all", legacy: false },
  pink: { names: [], stars: "all", legacy: false },
  unique: { stars: [], legacy: false },
  marks: [],
  cards: [],
};

const FILTER_STORE = "umalab.filters";

function loadFilters(): Filters {
  try {
    const raw = localStorage.getItem(FILTER_STORE);
    if (raw) {
      const p = JSON.parse(raw) as Filters;
      // Shallow shape check; anything off falls back wholesale.
      if (
        Array.isArray(p.blue?.names) &&
        Array.isArray(p.pink?.names) &&
        Array.isArray(p.unique?.stars) &&
        Array.isArray(p.marks) &&
        Array.isArray(p.cards)
      ) {
        return { ...defaultFilters, ...p };
      }
    }
  } catch {
    // unreadable storage or garbage value — fall through to the default
  }
  return defaultFilters;
}

const starOk = (star: number, mode: StarMode) =>
  mode === "all" ? true : mode === "2plus" ? star >= 2 : star === 3;

const countFilters = (f: Filters) =>
  f.blue.names.length +
  f.pink.names.length +
  f.unique.stars.length +
  f.marks.length +
  f.cards.length;

function matchesFilters(v: Veteran, f: Filters): boolean {
  // "Legacy" widens a spark section's pool to the whole 6-slot lineage.
  const pool = (legacy: boolean): Factor[] =>
    legacy ? [...v.factors, ...v.lineage.flatMap((m) => m.factors)] : v.factors;
  if (
    f.blue.names.length > 0 &&
    !pool(f.blue.legacy).some(
      (fa) =>
        fa.kind === "blue" && f.blue.names.includes(fa.name) && starOk(fa.star, f.blue.stars)
    )
  ) {
    return false;
  }
  if (
    f.pink.names.length > 0 &&
    !pool(f.pink.legacy).some(
      (fa) =>
        fa.kind === "pink" && f.pink.names.includes(fa.name) && starOk(fa.star, f.pink.stars)
    )
  ) {
    return false;
  }
  if (
    f.unique.stars.length > 0 &&
    !pool(f.unique.legacy).some(
      (fa) => fa.kind === "unique" && f.unique.stars.includes(fa.star)
    )
  ) {
    return false;
  }
  if (f.marks.length > 0 && !f.marks.includes(v.tags[0] ?? "")) return false;
  if (f.cards.length > 0 && !f.cards.includes(v.card_id)) return false;
  return true;
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

function SkillChips({ skills }: { skills: Skill[] }) {
  // Uniques (own and inherited) lead; the rest keep the dump's order.
  const sorted = [...skills].sort((a, b) => Number(b.unique) - Number(a.unique));
  return (
    <span className="chips">
      {sorted.map((s) => (
        <span
          key={s.skill_id}
          className={s.unique ? "chip unique" : s.rarity === 2 ? "chip gold" : "chip"}
          title={s.unique ? "Unique skill" : s.rarity === 2 ? "Gold skill" : undefined}
        >
          {s.name ?? `Skill ${s.skill_id}`}
          {s.unique && s.level > 1 ? ` Lv${s.level}` : ""}
        </span>
      ))}
    </span>
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

// Lineage rows are icon-identified like the cards — names live in tooltips.
const memberTitle = (m: LineageMember) =>
  `${m.name}${m.outfit && m.outfit !== "Original" ? ` (${m.outfit})` : ""}`;

function LineageSlot({
  member,
  label,
  icon,
}: {
  member: LineageMember;
  label: string;
  icon: string | undefined;
}) {
  return (
    <div className="lineage-slot">
      <div className="lineage-head" title={memberTitle(member)}>
        <span className="lineage-label">{label}</span>
        <LineageIcon icon={icon} name={member.name} />
      </div>
      <FactorChips factors={member.factors} />
    </div>
  );
}

function LineageIcon({ icon, name }: { icon: string | undefined; name: string }) {
  const [failed, setFailed] = useState(false);
  return icon && !failed ? (
    <img
      className="lineage-icon"
      src={`/icons/chara/${icon}`}
      alt=""
      onError={() => setFailed(true)}
    />
  ) : (
    <span className="lineage-icon lineage-icon-fallback" aria-hidden="true">
      {name.charAt(0)}
    </span>
  );
}

function ParentSection({
  parent,
  grandparents,
  label,
  iconIndex,
}: {
  parent: LineageMember;
  grandparents: LineageMember[];
  label: string;
  iconIndex: Record<string, string>;
}) {
  // Grandparent sparks are noise for the usual "what does this parent pass
  // on" glance — they stay collapsed until the parent row is clicked.
  const [open, setOpen] = useState(false);
  return (
    <div className="detail-section">
      <button
        className="lineage-parent"
        title={memberTitle(parent)}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={`${label}: ${memberTitle(parent)}`}
        disabled={grandparents.length === 0}
      >
        <span className="lineage-label">{label}</span>
        <LineageIcon icon={iconIndex[String(parent.card_id)]} name={parent.name} />
        {grandparents.length > 0 && (
          <span className="lineage-caret">{open ? "▾" : "▸"}</span>
        )}
      </button>
      <FactorChips factors={parent.factors} />
      {open &&
        grandparents.map((gp, j) => (
          <LineageSlot
            key={gp.position_id}
            member={gp}
            label={`Grandparent ${j + 1}`}
            icon={iconIndex[String(gp.card_id)]}
          />
        ))}
    </div>
  );
}

function VeteranDetail({
  v,
  iconIndex,
}: {
  v: Veteran;
  iconIndex: Record<string, string>;
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
      <div className="apt-groups">
        {APT_GROUPS.map(([group, apts]) => (
          <div key={group} className="apt-row">
            <span className="apt-group">{group}</span>
            {apts.map(([label, key]) => {
              const letter = apt(v[key] as number);
              return (
                <span key={key} className="apt-box">
                  <span className="apt-label">{label}</span>
                  <span className={`apt-letter ${gradeClass(letter)}`}>{letter}</span>
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <div className="detail-section">
        <div className="detail-heading">Skills</div>
        <SkillChips skills={v.skills} />
      </div>
      <div className="detail-section">
        <div className="detail-heading">Own sparks</div>
        <FactorChips factors={v.factors} />
      </div>
      {parents.map((parent, i) => (
        <ParentSection
          key={parent.position_id}
          parent={parent}
          grandparents={grandparentsOf(parent)}
          label={`Parent ${i + 1}`}
          iconIndex={iconIndex}
        />
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

function SparkSection({
  title,
  chips,
  kind,
  value,
  onChange,
}: {
  title: string;
  chips: [label: string, name: string][];
  kind: "blue" | "pink";
  value: SparkFilter;
  onChange: (next: SparkFilter) => void;
}) {
  const toggleName = (name: string) =>
    onChange({
      ...value,
      names: value.names.includes(name)
        ? value.names.filter((n) => n !== name)
        : [...value.names, name],
    });
  return (
    <div className="filter-section">
      <div className="filter-heading">{title}</div>
      <div className="filter-chips">
        {chips.map(([label, name]) => (
          <button
            key={name}
            className={`fchip ${kind}${value.names.includes(name) ? " active" : ""}`}
            onClick={() => toggleName(name)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="filter-opts">
        <span className="seg-group" role="radiogroup" aria-label={`${title} star level`}>
          {(["all", "2plus", "3"] as const).map((m) => (
            <button
              key={m}
              className={value.stars === m ? "seg active" : "seg"}
              aria-pressed={value.stars === m}
              onClick={() => onChange({ ...value, stars: m })}
            >
              {m === "all" ? "All" : m === "2plus" ? "2★+" : "3★"}
            </button>
          ))}
        </span>
        <button
          className={value.legacy ? "legacy-toggle active" : "legacy-toggle"}
          title="Also match sparks carried by parents and grandparents"
          aria-pressed={value.legacy}
          onClick={() => onChange({ ...value, legacy: !value.legacy })}
        >
          Legacy sparks
        </button>
      </div>
    </div>
  );
}

function FilterPanel({
  filters,
  cards,
  iconIndex,
  onChange,
  onClose,
}: {
  filters: Filters;
  cards: Veteran[];
  iconIndex: Record<string, string>;
  onChange: (next: Filters) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggleIn = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((x) => x !== value) : [...list, value];

  return (
    <>
      <div className="filter-backdrop" onClick={onClose} />
      <div className="filter-panel" role="dialog" aria-label="Filters">
        <header className="filter-header">
          <span className="filter-title">Filters</span>
          <button
            className="filter-clear"
            disabled={countFilters(filters) === 0}
            onClick={() => onChange(defaultFilters)}
          >
            Clear all
          </button>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <SparkSection
          title="Attribute sparks"
          chips={BLUE_ORDER.map((n) => [sparkAbbr(n), n])}
          kind="blue"
          value={filters.blue}
          onChange={(blue) => onChange({ ...filters, blue })}
        />
        <SparkSection
          title="Aptitude sparks"
          chips={PINK_SPARKS}
          kind="pink"
          value={filters.pink}
          onChange={(pink) => onChange({ ...filters, pink })}
        />

        <div className="filter-section">
          <div className="filter-heading">Unique spark</div>
          <div className="filter-chips">
            {[1, 2, 3].map((s) => (
              <button
                key={s}
                className={`fchip unique${filters.unique.stars.includes(s) ? " active" : ""}`}
                onClick={() =>
                  onChange({
                    ...filters,
                    unique: { ...filters.unique, stars: toggleIn(filters.unique.stars, s) },
                  })
                }
              >
                {s}★
              </button>
            ))}
          </div>
          <div className="filter-opts">
            <button
              className={filters.unique.legacy ? "legacy-toggle active" : "legacy-toggle"}
              title="Also match unique sparks carried by parents and grandparents"
              aria-pressed={filters.unique.legacy}
              onClick={() =>
                onChange({
                  ...filters,
                  unique: { ...filters.unique, legacy: !filters.unique.legacy },
                })
              }
            >
              Legacy sparks
            </button>
          </div>
        </div>

        <div className="filter-section">
          <div className="filter-heading">Favorites</div>
          <div className="filter-chips">
            {MARK_IDS.map((id) => (
              <button
                key={id}
                className={filters.marks.includes(id) ? "mark-toggle active" : "mark-toggle"}
                title={`Mark ${Number(id.slice(-2))}`}
                onClick={() => onChange({ ...filters, marks: toggleIn(filters.marks, id) })}
              >
                <MarkIcon id={id} />
              </button>
            ))}
          </div>
        </div>

        <div className="filter-section">
          <div className="filter-heading">Umas</div>
          <div className="filter-chips filter-cards">
            {cards.map((c) => {
              const icon = iconIndex[String(c.card_id)];
              const title = `${c.name}${c.outfit && c.outfit !== "Original" ? ` (${c.outfit})` : ""}`;
              return (
                <button
                  key={c.card_id}
                  className={
                    filters.cards.includes(c.card_id) ? "card-chip active" : "card-chip"
                  }
                  title={title}
                  aria-label={title}
                  onClick={() =>
                    onChange({ ...filters, cards: toggleIn(filters.cards, c.card_id) })
                  }
                >
                  {icon ? (
                    <img src={`/icons/chara/${icon}`} alt="" loading="lazy" />
                  ) : (
                    <span className="lineage-icon-fallback">{c.name.charAt(0)}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

function VeteranModal({
  v,
  iconIndex,
  onClose,
  onChanged,
  onError,
}: {
  v: Veteran;
  iconIndex: Record<string, string>;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  // Mark picker popup state lives here so Escape can close it before the
  // modal itself.
  const [markOpen, setMarkOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (markOpen) {
        setMarkOpen(false);
      } else {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, markOpen]);

  useEffect(() => {
    // The backdrop scrolls instead of the page while the modal is open.
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const stats: [label: string, value: number][] = [
    ["Speed", v.speed],
    ["Stamina", v.stamina],
    ["Power", v.power],
    ["Guts", v.guts],
    ["Wit", v.wiz],
  ];

  const title = `${v.name}${v.outfit && v.outfit !== "Original" ? ` (${v.outfit})` : ""}`;
  const icon = iconIndex[String(v.card_id)];
  const tier = rankTier(v.rank_score);

  // Single-select: picking another mark moves the selection (the backend
  // replaces), picking the active one clears it.
  const currentMark = v.tags[0];
  const pickMark = async (id: string) => {
    setMarkOpen(false);
    let failure: string | null = null;
    try {
      if (id === currentMark) {
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
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <span className="modal-id" title={title}>
            <span className="card-art modal-art">
              {icon ? (
                <img src={`/icons/chara/${icon}`} alt="" />
              ) : (
                <span className="card-fallback" aria-hidden="true">
                  {v.name.charAt(0)}
                </span>
              )}
              <span
                className={`card-rank rank-${tier[0].toLowerCase()}`}
                title={`Rank ${tier} (${v.rank_score.toLocaleString()})`}
              >
                {tier}
              </span>
              <button
                className="modal-mark"
                aria-expanded={markOpen}
                aria-label={currentMark ? "Change mark" : "Set mark"}
                title={currentMark ? "Change mark" : "Set mark"}
                onClick={() => setMarkOpen(!markOpen)}
              >
                {currentMark ? (
                  <MarkIcon id={currentMark} />
                ) : (
                  <span className="modal-mark-empty" aria-hidden="true">
                    +
                  </span>
                )}
              </button>
              {markOpen && (
                <>
                  {/* invisible click-away layer; the modal's own onClick
                      already stops propagation, so this never closes it */}
                  <span
                    className="mark-popup-backdrop"
                    onClick={() => setMarkOpen(false)}
                  />
                  <span className="mark-popup" role="dialog" aria-label="Choose mark">
                    {/* 4×4: the deselect tile leads, then the 15 marks. */}
                    <button
                      className={currentMark ? "mark-toggle mark-clear" : "mark-toggle mark-clear active"}
                      title="No mark"
                      aria-label="No mark"
                      onClick={() =>
                        void (currentMark ? pickMark(currentMark) : setMarkOpen(false))
                      }
                    >
                      <span className="mark-none" aria-hidden="true">
                        ✕
                      </span>
                    </button>
                    {MARK_IDS.map((id) => (
                      <button
                        key={id}
                        className={id === currentMark ? "mark-toggle active" : "mark-toggle"}
                        title={id === currentMark ? "Remove mark" : "Set mark"}
                        onClick={() => void pickMark(id)}
                      >
                        <MarkIcon id={id} />
                      </button>
                    ))}
                  </span>
                </>
              )}
            </span>
            <span className="modal-names">
              {v.title && <span className="modal-card-title">{v.title}</span>}
              <span className="modal-name">{v.name}</span>
            </span>
          </span>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <table className="stat-table">
          <thead>
            <tr>
              {stats.map(([label]) => (
                <th key={label}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {stats.map(([label, value]) => {
                const grade = statGrade(value);
                return (
                  <td key={label}>
                    <span className={`stat-grade ${gradeClass(grade)}`}>{grade}</span>
                    {value}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
        <div className="stat-row">
          <span>
            <span className="stat-label">Fans</span>
            {v.fans.toLocaleString()}
          </span>
          <span>
            <span className="stat-label">Wins</span>
            {v.wins}
          </span>
          <span>
            <span className="stat-label">Trained</span>
            {v.register_time.slice(0, 10)}
          </span>
        </div>
        <VeteranDetail v={v} iconIndex={iconIndex} />
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

  const applyFilters = (next: Filters) => {
    setFilters(next);
    try {
      localStorage.setItem(FILTER_STORE, JSON.stringify(next));
    } catch {
      // storage full/blocked — the choice still applies for this session
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

      {error && <p className="error">{error}</p>}

      {veterans.length === 0 && !error ? (
        <p className="empty">
          No roster yet. Run UmaExtractor on the game's Veteran List screen, then import the
          <code> data.json</code> it produces.
        </p>
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
        <button className="filter-float" onClick={() => setFilterOpen(true)}>
          Filters
          {countFilters(filters) > 0 && (
            <span className="filter-count">{countFilters(filters)}</span>
          )}
        </button>
      )}

      {filterOpen && (
        <FilterPanel
          filters={filters}
          cards={rosterCards}
          iconIndex={iconIndex}
          onChange={applyFilters}
          onClose={() => setFilterOpen(false)}
        />
      )}

      {veterans.length > 0 && (
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
