// Minimal identity shape so both roster veterans and catalog entries fit
// (PR 3 flagged the old `card: Veteran` prop ahead of this second consumer).
export function UmaCardChip({
  name,
  outfit,
  icon,
  active,
  disabledReason,
  onToggle,
}: {
  name: string;
  outfit?: string;
  icon: string | undefined;
  active: boolean;
  // Set ⇒ the chip is unpickable and the reason becomes its tooltip.
  disabledReason?: string;
  onToggle: () => void;
}) {
  const title =
    disabledReason ?? `${name}${outfit && outfit !== "Original" ? ` (${outfit})` : ""}`;
  return (
    <button
      className={active ? "card-chip active" : "card-chip"}
      title={title}
      aria-label={title}
      disabled={disabledReason !== undefined}
      onClick={onToggle}
    >
      {icon ? (
        <img src={`/icons/chara/${icon}`} alt="" loading="lazy" />
      ) : (
        <span className="lineage-icon-fallback">{name.charAt(0)}</span>
      )}
    </button>
  );
}
