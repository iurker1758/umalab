import { Fragment } from "react";
import { APTITUDE_GROUPS, APTITUDE_LABELS, type AptitudeRow } from "../aptitude";
import { gradeClass } from "../domain";

// The ten career-start letters in the game's three groups. Display rulings
// (DECISIONS.md #26): the letter cell shows the FINAL letter only, boosted =
// highlighted, no strikethrough — the cause math lives in the From column.
// Bump past the A cap is a soft info note, never a warning — overstacking is
// often intentional, since every matching spark is an independent
// inspiration-proc ticket toward S.
export function AptitudeTable({ rows }: { rows: AptitudeRow[] }) {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return (
    <table className="apt-table">
      <tbody>
        {APTITUDE_GROUPS.map(([group, keys]) => (
          <Fragment key={group}>
            <tr>
              <th colSpan={3}>{group}</th>
            </tr>
            {keys.map((key) => {
              const r = byKey.get(key);
              if (r === undefined) return null;
              return (
                <tr key={key}>
                  <td className="apt-key">{APTITUDE_LABELS[key]}</td>
                  <td>
                    {r.final === null ? (
                      <span className="apt-unknown" title="This card's base letters are unknown">
                        ?
                      </span>
                    ) : (
                      <b className={`apt-final ${gradeClass(r.final)}${r.boosted ? " boosted" : ""}`}>
                        {r.final}
                      </b>
                    )}
                  </td>
                  <td className="apt-from">
                    {/* Only a projection has a cause to explain. The other
                        two modes say where the letter came from instead. */}
                    {r.mode === "trained" && (
                      <span
                        className="apt-cap"
                        title="Read from this veteran's own roster record — what she finished her career with, not a career-start projection"
                      >
                        as trained
                      </span>
                    )}
                    {r.mode === "base" && (
                      <span
                        className="apt-cap"
                        title="This card's starting letters. A veteran pulled from a lineage records who she is but not what she trained to, and her own window is missing two thirds of its slots — the game stores two generations per veteran — so there is nothing here to project from."
                      >
                        card base
                      </span>
                    )}
                    {r.mode === "project" && r.stars > 0 && (
                      // Without a base the bump has nothing to land on —
                      // show the raw ★ total only.
                      <>{r.base === null ? `${r.stars}★` : `${r.stars}★ → +${r.bump}`}</>
                    )}
                  </td>
                </tr>
              );
            })}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}
