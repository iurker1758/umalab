import { useState } from "react";
import type { Factor, Veteran } from "../api";
import { rankTier, sparkAbbr } from "../domain";
import { MarkIcon } from "./MarkIcon";

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

export function VeteranCard({
  v,
  icon,
  showSparks,
  selectMode = false,
  selected = false,
  onOpen,
}: {
  v: Veteran;
  icon: string | undefined;
  showSparks: boolean;
  // In selection mode a click toggles membership instead of opening the
  // modal; the caller owns that branch — the card just renders the state.
  selectMode?: boolean;
  selected?: boolean;
  onOpen: () => void;
}) {
  const [artFailed, setArtFailed] = useState(false);
  const title = `${v.name}${v.outfit && v.outfit !== "Original" ? ` (${v.outfit})` : ""}`;
  const tier = rankTier(v.rank_score);
  return (
    <button
      className={selected ? "card selected" : "card"}
      title={title}
      aria-label={title}
      aria-pressed={selectMode ? selected : undefined}
      onClick={onOpen}
    >
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
        {selectMode && (
          // Every card grows the ring in selection mode so unmarked cards
          // still read as selectable targets; only selected ones fill it.
          <span className="card-check" aria-hidden="true">
            ✓
          </span>
        )}
      </span>
      {showSparks ? (
        <SparkStrip v={v} />
      ) : (
        <span className="card-score">{v.rank_score.toLocaleString()}</span>
      )}
    </button>
  );
}
