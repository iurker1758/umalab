import type { AffinityResult } from "../api";
import { LINK_LABELS } from "../blueprint";

// Band symbols from the game's rank table (relations.json): △ ≤50,
// ○ 51–150, ◎ ≥151.
const SYMBOL_CLASS: Record<string, string> = {
  "△": "aff-low",
  "○": "aff-good",
  "◎": "aff-best",
};

export function AffinityPanel({
  affinity,
  failed = false,
}: {
  affinity: AffinityResult | null;
  // The last scoring request failed — shown inline instead of a toast so a
  // downed backend doesn't spam one error per edit.
  failed?: boolean;
}) {
  return (
    <div className="designer-panel">
      <div className="filter-heading">Affinity</div>
      {failed ? (
        <p className="designer-hint aff-error">
          Couldn't score this design — is the backend running? It retries on
          the next change.
        </p>
      ) : affinity === null ? (
        <p className="designer-hint">
          Pick a trainee and at least one parent to score the pairing.
        </p>
      ) : (
        <>
          <div className="aff-total">
            <span
              className={`aff-symbol ${SYMBOL_CLASS[affinity.symbol] ?? ""}`}
              aria-label={`Affinity band ${affinity.symbol}`}
            >
              {affinity.symbol}
            </span>
            <span className="aff-number">{affinity.total}</span>
          </div>
          <div className="aff-breakdown">
            Relations {affinity.relation_total} + G1 wins {affinity.win_total}
          </div>
          <table className="aff-links">
            <tbody>
              {affinity.links.map((l) => (
                <tr key={l.link}>
                  <td className="aff-link-name">{LINK_LABELS[l.link] ?? l.link}</td>
                  <td className="aff-link-pts">{l.relation_points}</td>
                  <td className="aff-link-pts">+{l.win_points}</td>
                  <td className="aff-link-sum">{l.relation_points + l.win_points}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(affinity.p1_affinity !== null || affinity.p2_affinity !== null) && (
            <div className="aff-parents">
              {affinity.p1_affinity !== null && (
                <span>Parent 1 side {affinity.p1_affinity}</span>
              )}
              {affinity.p2_affinity !== null && (
                <span>Parent 2 side {affinity.p2_affinity}</span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
