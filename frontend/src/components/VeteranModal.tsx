import { useEffect, useState } from "react";
import { api, type LineageMember, type Veteran } from "../api";
import { APT_GROUPS, apt, gradeClass, rankTier, statGrade } from "../domain";
import { FactorChips, SkillChips } from "./FactorChips";
import { MarkIcon } from "./MarkIcon";
import { MarkPicker } from "./MarkPicker";

// Lineage rows lead with the icon, but the name stays in the DOM as a muted
// caption — tooltips alone never fire on touch, and without icon art (a
// fresh clone; DECISIONS.md #10) the row would otherwise be a bare initial.
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
        <span className="lineage-name">{memberTitle(member)}</span>
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
      {/* aria-disabled + click guard, not disabled: a disabled button
          swallows pointer events, which also killed the title tooltip. */}
      <button
        className="lineage-parent"
        title={memberTitle(parent)}
        onClick={() => grandparents.length > 0 && setOpen(!open)}
        aria-expanded={open}
        aria-label={`${label}: ${memberTitle(parent)}`}
        aria-disabled={grandparents.length === 0}
      >
        <span className="lineage-label">{label}</span>
        <LineageIcon icon={iconIndex[String(parent.card_id)]} name={parent.name} />
        <span className="lineage-name">{memberTitle(parent)}</span>
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
        <div className="detail-heading">Own Sparks</div>
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

export function VeteranModal({
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
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
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
                <MarkPicker
                  activeId={currentMark ?? null}
                  clearTitle="No mark"
                  tileTitle="Set mark"
                  activeTileTitle="Remove mark"
                  ariaLabel="Choose mark"
                  onPick={(id) => {
                    // Single-select semantics: picking the active mark (or the
                    // clear tile while marked) removes; clear while unmarked
                    // just closes.
                    if (id === null) {
                      if (currentMark) void pickMark(currentMark);
                      else setMarkOpen(false);
                    } else {
                      void pickMark(id);
                    }
                  }}
                  onClose={() => setMarkOpen(false)}
                />
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
