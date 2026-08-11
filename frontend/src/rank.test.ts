import { describe, expect, it } from "vitest";
import { byQueryRank } from "./rank";

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
