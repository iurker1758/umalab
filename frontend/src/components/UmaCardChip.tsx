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
  // Set ⇒ the chip is unpickable and the reason joins its tooltip.
  disabledReason?: string;
  onToggle: () => void;
}) {
  const identity = `${name}${outfit && outfit !== "Original" ? ` (${outfit})` : ""}`;
  // aria-disabled + no-op, not the disabled attribute: Chromium/WebKit
  // don't dispatch pointer events to natively disabled controls, so the
  // `title` explaining WHY a pick is illegal would never show. The reason
  // augments the accessible name rather than replacing it.
  const blocked = disabledReason !== undefined;
  const title = blocked ? `${identity} — ${disabledReason}` : identity;
  return (
    <button
      className={`card-chip${active ? " active" : ""}${blocked ? " disabled" : ""}`}
      title={title}
      aria-label={title}
      aria-disabled={blocked || undefined}
      onClick={blocked ? undefined : onToggle}
    >
      {icon ? (
        <img src={`/icons/chara/${icon}`} alt="" loading="lazy" />
      ) : (
        <span className="lineage-icon-fallback">{name.charAt(0)}</span>
      )}
    </button>
  );
}
