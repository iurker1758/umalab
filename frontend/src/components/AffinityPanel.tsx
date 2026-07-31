import type { AffinityResult } from "../api";
import { LINK_LABELS } from "../blueprint";
import { affinityClass } from "../domain";

// Run affinity for the trainee — the compatibility number the game shows on
// the parent-select screen, scored server-side (DECISIONS.md #17) so the one
// verified implementation of the formula stays the only one.
//
// The trainee's panel only: affinity is a property of the pairing you are
// about to run, not of any one ancestor, so hanging it off a grandparent
// would invite reading it as that grandparent's own.
//
// The total also rides on the trainee's map chip (see TreeMap), so the number
// you judge a pairing by is legible without opening the panel. This is where
// it is explained.
export function AffinityPanel({
  affinity,
  traineeSet,
  failed = false,
}: {
  affinity: AffinityResult | null;
  // Whether the trainee is cast, which is half of the scoring threshold —
  // so the hint below can name what's actually missing rather than asking
  // for a trainee that's already in the slot above it.
  traineeSet: boolean;
  // The last scoring request failed — shown inline instead of a toast so a
  // downed backend doesn't spam one error per edit.
  failed?: boolean;
}) {
  return (
    <>
      <h4>Run affinity</h4>
      {failed ? (
        <p className="focus-note aff-error">
          Couldn&apos;t score this design — is the backend running? It retries on the next
          change.
        </p>
      ) : affinity === null ? (
        <p className="focus-note">
          Pick {traineeSet ? "" : "a trainee and "}at least one parent to score the pairing.
        </p>
      ) : (
        <>
          <div className="aff-total">
            <span
              className={`aff-symbol ${affinityClass(affinity.symbol)}`}
              aria-label={`Affinity band ${affinity.symbol}`}
            >
              {affinity.symbol}
            </span>
            <span className="aff-number">{affinity.total}</span>
          </div>
          {/* The seven links the total decomposes into. No relation/win
              summary line and no per-ancestor list: the table's own columns
              ARE relations and wins, and a parent's share is only its own
              rows added up — both were built and cut as restatements
              (DECISIONS.md #29). The `*_affinity` shares stay in the response
              for the inspiration-proc model, which rolls per ancestor. */}
          <table className="aff-links">
            {/* Three bare numbers per row are unreadable without these —
                "19 +0 19" says nothing about which is the relation sum,
                which is the win bonus, and which is the two added up. */}
            <thead>
              <tr>
                <th scope="col" className="aff-link-name">Link</th>
                {/* Abbreviated, with the full wording on hover: spelled out,
                    the two middle headers are wider than the panel can give
                    them and every link name wraps to two lines. */}
                <th scope="col" className="aff-link-pts" title="Relation points">
                  Rel.
                </th>
                <th scope="col" className="aff-link-pts" title="Shared G1 wins">
                  Wins
                </th>
                <th scope="col" className="aff-link-sum">Total</th>
              </tr>
            </thead>
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
        </>
      )}
    </>
  );
}
