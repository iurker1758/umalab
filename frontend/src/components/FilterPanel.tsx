import { useEffect, useState } from "react";
import type { Veteran } from "../api";
import { BLUE_ORDER, MARK_IDS, sparkAbbr } from "../domain";
import {
  PINK_SPARK_GROUPS,
  STAR_MODES,
  countFilters,
  defaultFilters,
  starModeLabel,
  type Filters,
  type SparkFilter,
  type StarMode,
  type WhiteFilter,
} from "../filters";
import { MarkIcon } from "./MarkIcon";

function StarModeRow({
  stars,
  legacy,
  ariaLabel,
  onStars,
  onLegacy,
}: {
  stars: StarMode;
  legacy: boolean;
  ariaLabel: string;
  onStars: (m: StarMode) => void;
  onLegacy: () => void;
}) {
  return (
    <div className="filter-opts">
      <span className="seg-group" role="radiogroup" aria-label={ariaLabel}>
        {STAR_MODES.map((m) => (
          <button
            key={m}
            className={stars === m ? "seg active" : "seg"}
            aria-pressed={stars === m}
            onClick={() => onStars(m)}
          >
            {starModeLabel(m)}
          </button>
        ))}
      </span>
      <button
        className={legacy ? "legacy-toggle active" : "legacy-toggle"}
        title="Also match sparks carried by parents and grandparents"
        aria-pressed={legacy}
        onClick={onLegacy}
      >
        Legacy Sparks
      </button>
    </div>
  );
}

function SparkSection({
  title,
  groups,
  kind,
  value,
  onChange,
}: {
  title: string;
  groups: [group: string | null, chips: [label: string, name: string][]][];
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
      {groups.map(([group, chips], i) => (
        <div key={group ?? i} className="filter-chip-row">
          {group && <span className="filter-group-label">{group}</span>}
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
      ))}
      <StarModeRow
        stars={value.stars}
        legacy={value.legacy}
        ariaLabel={`${title} star level`}
        onStars={(stars) => onChange({ ...value, stars })}
        onLegacy={() => onChange({ ...value, legacy: !value.legacy })}
      />
    </div>
  );
}

function UmaCardChip({
  card,
  icon,
  active,
  onToggle,
}: {
  card: Veteran;
  icon: string | undefined;
  active: boolean;
  onToggle: () => void;
}) {
  const title = `${card.name}${card.outfit && card.outfit !== "Original" ? ` (${card.outfit})` : ""}`;
  return (
    <button
      className={active ? "card-chip active" : "card-chip"}
      title={title}
      aria-label={title}
      onClick={onToggle}
    >
      {icon ? (
        <img src={`/icons/chara/${icon}`} alt="" loading="lazy" />
      ) : (
        <span className="lineage-icon-fallback">{card.name.charAt(0)}</span>
      )}
    </button>
  );
}

export function FilterPanel({
  filters,
  cards,
  whiteNames,
  iconIndex,
  matchCount,
  total,
  onChange,
  onClose,
}: {
  filters: Filters;
  cards: Veteran[];
  whiteNames: string[];
  iconIndex: Record<string, string>;
  matchCount: number;
  total: number;
  onChange: (next: Filters) => void;
  onClose: () => void;
}) {
  const [umaOpen, setUmaOpen] = useState(false);
  const [umaQuery, setUmaQuery] = useState("");
  const [sparkOpen, setSparkOpen] = useState(false);
  const [sparkQuery, setSparkQuery] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (umaOpen) {
        setUmaOpen(false);
      } else if (sparkOpen) {
        setSparkOpen(false);
      } else {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, umaOpen, sparkOpen]);

  const toggleIn = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
  const toggleCard = (id: number) =>
    onChange({ ...filters, cards: toggleIn(filters.cards, id) });
  const toggleWhite = (name: string) =>
    onChange({
      ...filters,
      whites: filters.whites.some((w) => w.name === name)
        ? filters.whites.filter((w) => w.name !== name)
        : [...filters.whites, { name, stars: "all" as const, legacy: false }],
    });
  const updateWhite = (name: string, patch: Partial<WhiteFilter>) =>
    onChange({
      ...filters,
      whites: filters.whites.map((w) => (w.name === name ? { ...w, ...patch } : w)),
    });

  const query = umaQuery.trim().toLowerCase();
  const queried = query
    ? cards.filter((c) =>
        `${c.name} ${c.outfit}`.toLowerCase().includes(query)
      )
    : cards;
  const sq = sparkQuery.trim().toLowerCase();
  const queriedSparks = sq
    ? whiteNames.filter((n) => n.toLowerCase().includes(sq))
    : whiteNames;

  return (
    <>
      {/* Overlays dismiss on mousedown, not click: Chrome freezes the OS
          cursor when a click unmounts the element under it, which reads as
          "hover is broken" until the next click. Closing on mousedown lets
          the cursor recompute at mouseup. */}
      <div className="filter-backdrop" onMouseDown={onClose} />
      <div className="filter-panel" role="dialog" aria-label="Filters">
        <header className="filter-header">
          <span className="filter-title">Filters</span>
          <span className="filter-match">
            {matchCount} of {total} match
          </span>
          <button
            className="filter-clear"
            disabled={countFilters(filters) === 0}
            onClick={() => onChange(defaultFilters)}
          >
            Reset Filters
          </button>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="filter-section">
          <div className="filter-heading">Umas</div>
          <div className="filter-chips">
            <button
              className="fchip"
              onClick={() => {
                setUmaQuery("");
                setUmaOpen(true);
              }}
            >
              Choose Umas…
            </button>
            {cards
              .filter((c) => filters.cards.includes(c.card_id))
              .map((c) => (
                <UmaCardChip
                  key={c.card_id}
                  card={c}
                  icon={iconIndex[String(c.card_id)]}
                  active
                  onToggle={() => toggleCard(c.card_id)}
                />
              ))}
          </div>
        </div>

        <SparkSection
          title="Attribute Sparks"
          groups={[[null, BLUE_ORDER.map((n) => [sparkAbbr(n), n])]]}
          kind="blue"
          value={filters.blue}
          onChange={(blue) => onChange({ ...filters, blue })}
        />
        <SparkSection
          title="Aptitude Sparks"
          groups={PINK_SPARK_GROUPS}
          kind="pink"
          value={filters.pink}
          onChange={(pink) => onChange({ ...filters, pink })}
        />

        <div className="filter-section">
          <div className="filter-heading">Unique Spark</div>
          <StarModeRow
            stars={filters.unique.stars}
            legacy={filters.unique.legacy}
            ariaLabel="Unique spark star level"
            onStars={(stars) =>
              onChange({ ...filters, unique: { ...filters.unique, stars } })
            }
            onLegacy={() =>
              onChange({
                ...filters,
                unique: { ...filters.unique, legacy: !filters.unique.legacy },
              })
            }
          />
        </div>

        <div className="filter-section">
          <div className="filter-heading">Common Sparks</div>
          <div className="filter-chips">
            <button
              className="fchip"
              onClick={() => {
                setSparkQuery("");
                setSparkOpen(true);
              }}
            >
              Choose Sparks…
            </button>
            {filters.whites.length > 0 && (
              <button
                className="fchip"
                onClick={() => onChange({ ...filters, whites: [] })}
              >
                Reset Sparks
              </button>
            )}
          </div>
          {filters.whites.map((w) => (
            <div key={w.name} className="white-row">
              <button
                className="fchip white active"
                title="Remove"
                onClick={() => toggleWhite(w.name)}
              >
                {w.name} ✕
              </button>
              <StarModeRow
                stars={w.stars}
                legacy={w.legacy}
                ariaLabel={`${w.name} star level`}
                onStars={(stars) => updateWhite(w.name, { stars })}
                onLegacy={() => updateWhite(w.name, { legacy: !w.legacy })}
              />
            </div>
          ))}
        </div>

        <div className="filter-section">
          <div className="filter-heading">Favorites</div>
          <div className="filter-chips">
            <button
              className={filters.marks.includes("") ? "mark-toggle active" : "mark-toggle"}
              title="No favorite"
              aria-label="No favorite"
              onClick={() => onChange({ ...filters, marks: toggleIn(filters.marks, "") })}
            >
              <span className="mark-none" aria-hidden="true">
                ✕
              </span>
            </button>
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
      </div>

      {umaOpen && (
        <>
          <div className="uma-popout-backdrop" onMouseDown={() => setUmaOpen(false)} />
          <div className="uma-popout" role="dialog" aria-label="Choose umas">
            <input
              className="uma-search"
              type="search"
              placeholder="Search by name…"
              value={umaQuery}
              autoFocus
              onChange={(e) => setUmaQuery(e.target.value)}
            />
            <div className="filter-chips">
              {queried.map((c) => (
                <UmaCardChip
                  key={c.card_id}
                  card={c}
                  icon={iconIndex[String(c.card_id)]}
                  active={filters.cards.includes(c.card_id)}
                  onToggle={() => toggleCard(c.card_id)}
                />
              ))}
              {queried.length === 0 && <span className="empty">No umas match.</span>}
            </div>
          </div>
        </>
      )}

      {sparkOpen && (
        <>
          <div className="uma-popout-backdrop" onMouseDown={() => setSparkOpen(false)} />
          <div className="uma-popout" role="dialog" aria-label="Choose common sparks">
            <input
              className="uma-search"
              type="search"
              placeholder="Search sparks…"
              value={sparkQuery}
              autoFocus
              onChange={(e) => setSparkQuery(e.target.value)}
            />
            <div className="filter-chips">
              {queriedSparks.map((n) => (
                <button
                  key={n}
                  className={`fchip white${filters.whites.some((w) => w.name === n) ? " active" : ""}`}
                  onClick={() => toggleWhite(n)}
                >
                  {n}
                </button>
              ))}
              {queriedSparks.length === 0 && <span className="empty">No sparks match.</span>}
            </div>
          </div>
        </>
      )}
    </>
  );
}
