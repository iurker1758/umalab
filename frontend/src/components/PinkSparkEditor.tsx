import { APTITUDE_KEYS, type AptitudeKey, type PinkSpark } from "../api";
import { APTITUDE_LABELS } from "../aptitude";

// The pink-only spark editor (v1 scope ruling): one aptitude, 1–3★.
// Selecting an aptitude on an empty editor starts at 3★ — the planning
// default; clearing back to "No pink spark" drops the spark entirely.
export function PinkSparkEditor({
  label,
  spark,
  onChange,
}: {
  // Distinguishes the many editors on one page for aria/testing.
  label: string;
  spark: PinkSpark | null;
  onChange: (spark: PinkSpark | null) => void;
}) {
  return (
    <div className="spark-editor">
      <select
        aria-label={`${label} pink spark`}
        value={spark?.aptitude ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === "" ? null : { aptitude: v as AptitudeKey, stars: spark?.stars ?? 3 });
        }}
      >
        <option value="">No pink spark</option>
        {APTITUDE_KEYS.map((k) => (
          <option key={k} value={k}>
            {APTITUDE_LABELS[k]}
          </option>
        ))}
      </select>
      {spark !== null && (
        <span className="seg-group" role="radiogroup" aria-label={`${label} stars`}>
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              className={spark.stars === n ? "seg active" : "seg"}
              aria-pressed={spark.stars === n}
              onClick={() => onChange({ ...spark, stars: n })}
            >
              {n}★
            </button>
          ))}
        </span>
      )}
    </div>
  );
}
