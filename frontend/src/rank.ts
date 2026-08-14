// Query matching and ranking shared by the spark browsers (the chooser's
// popout and the list page's). Pure so it stays testable under the node-only
// vitest config.

/**
 * Sort by where the query first appears in the name — an earlier hit is a
 * better hit — with ties in alphabetical order. `q` must already be
 * lowercased, and every candidate must contain it: the caller filters first,
 * so `indexOf` is never -1 here.
 */
export const byQueryRank =
  (q: string) =>
  (a: { name: string }, b: { name: string }): number =>
    a.name.toLowerCase().indexOf(q) - b.name.toLowerCase().indexOf(q) ||
    a.name.localeCompare(b.name);

/**
 * One rule for every section: `include` composes the popout's own narrowing
 * (possibility, filter pills), the query narrows by name, and hits rank by
 * where the query lands in the name then alphabetically — a no-op with no
 * query, the reference arriving sorted by (kind, name) already. `q` must be
 * trimmed and lowercased, as `byQueryRank` requires.
 */
export const matchingByQuery =
  <T extends { name: string }>(q: string, include: (o: T) => boolean = () => true) =>
  (options: T[]): T[] => {
    const hits = options.filter((o) => include(o) && o.name.toLowerCase().includes(q));
    return q === "" ? hits : hits.sort(byQueryRank(q));
  };
