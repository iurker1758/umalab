import type { SparkTotal, SparkTotalsData } from "../blueprint";

function SparkRow({ title, totals }: { title: string; totals: SparkTotal[] }) {
  if (totals.length === 0) return null;
  return (
    <div className="spark-total-row">
      <span className="spark-total-label">{title}</span>
      <span className="chips">
        {totals.map((t) => (
          <span key={t.name} className={`chip ${t.kind}`}>
            {t.name} ★{t.stars}
          </span>
        ))}
      </span>
    </div>
  );
}

export function SparkTotals({ totals }: { totals: SparkTotalsData }) {
  const empty =
    totals.blue.length === 0 &&
    totals.pink.length === 0 &&
    totals.unique.length === 0 &&
    totals.common.length === 0;
  return (
    <div className="designer-panel">
      <div className="filter-heading">Spark totals</div>
      {empty ? (
        <p className="designer-hint">
          Sparks add up here as you fill slots from your roster — catalog picks
          are theoretical and carry none.
        </p>
      ) : (
        <>
          <SparkRow title="Attribute" totals={totals.blue} />
          <SparkRow title="Aptitude" totals={totals.pink} />
          <SparkRow title="Unique" totals={totals.unique} />
          <SparkRow title="Common" totals={totals.common} />
        </>
      )}
    </div>
  );
}
