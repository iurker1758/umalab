import { describe, expect, it } from "vitest";
import { byQueryRank, matchingByQuery } from "./rank";

const names = (list: { name: string }[]) => list.map((o) => o.name);

describe("ranking by query position", () => {
  it("puts an earlier hit first", () => {
    const rows = [{ name: "Straightaway Recovery" }, { name: "Corner Recovery" }];
    expect(names([...rows].sort(byQueryRank("recovery")))).toEqual([
      "Corner Recovery",
      "Straightaway Recovery",
    ]);
  });

  it("matches case-insensitively against a lowercased query", () => {
    const rows = [{ name: "PROFESSOR of Curvature" }, { name: "A Professor" }];
    expect(names([...rows].sort(byQueryRank("professor")))).toEqual([
      "PROFESSOR of Curvature",
      "A Professor",
    ]);
  });

  it("breaks position ties alphabetically", () => {
    const rows = [{ name: "Swinging Maestro" }, { name: "Corner Adept" }];
    expect(names([...rows].sort(byQueryRank("")))).toEqual([
      "Corner Adept",
      "Swinging Maestro",
    ]);
  });
});

describe("matching by query", () => {
  const rows = [
    { name: "Swinging Maestro" },
    { name: "Straightaway Recovery" },
    { name: "Corner Recovery" },
  ];

  it("keeps the caller's order when the query is empty", () => {
    expect(names(matchingByQuery("")(rows))).toEqual([
      "Swinging Maestro",
      "Straightaway Recovery",
      "Corner Recovery",
    ]);
  });

  it("narrows to name hits and ranks them", () => {
    expect(names(matchingByQuery("recovery")(rows))).toEqual([
      "Corner Recovery",
      "Straightaway Recovery",
    ]);
  });

  it("composes the caller's own predicate with the query", () => {
    const notCorner = (o: { name: string }) => !o.name.startsWith("Corner");
    expect(names(matchingByQuery("recovery", notCorner)(rows))).toEqual([
      "Straightaway Recovery",
    ]);
  });
});
