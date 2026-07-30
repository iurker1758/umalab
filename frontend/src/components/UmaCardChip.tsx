import type { Veteran } from "../api";

export function UmaCardChip({
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
