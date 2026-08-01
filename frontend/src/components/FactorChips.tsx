import type { Factor, Skill } from "../api";

export function SkillChips({ skills }: { skills: Skill[] }) {
  // Uniques (own and inherited) lead; the rest keep the dump's order.
  const sorted = [...skills].sort((a, b) => Number(b.unique) - Number(a.unique));
  return (
    <span className="chips">
      {sorted.map((s) => (
        <span
          key={s.skill_id}
          className={s.unique ? "chip unique" : s.rarity === 2 ? "chip gold" : "chip"}
          title={s.unique ? "Unique Skill" : s.rarity === 2 ? "Gold Skill" : undefined}
        >
          {s.name ?? `Skill ${s.skill_id}`}
          {s.unique && s.level > 1 ? ` Lv${s.level}` : ""}
        </span>
      ))}
    </span>
  );
}

export function FactorChips({ factors }: { factors: Factor[] }) {
  return (
    <span className="chips">
      {factors.map((f) => (
        <span key={f.factor_id} className={`chip ${f.kind}`}>
          {f.name} ★{f.star}
        </span>
      ))}
    </span>
  );
}
