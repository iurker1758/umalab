// Query ranking shared by the spark browsers (the chooser's popout and the
// list page's). Pure so it stays testable under the node-only vitest config.

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
