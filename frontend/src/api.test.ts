import { describe, expect, it } from "vitest";
import { ApiError, detailOr } from "./api";

describe("surfacing the server's refusal", () => {
  it("passes a 409's words through, capitalized and terminated", () => {
    const error = new ApiError(409, "you already have a list with that name, ignoring case");
    expect(detailOr(error, "fallback")).toBe(
      "You already have a list with that name, ignoring case."
    );
  });

  it("passes a 422 through the same way — a permanent refusal must not read as transient", () => {
    const error = new ApiError(422, "string should have at most 40 characters");
    expect(detailOr(error, "fallback")).toBe("String should have at most 40 characters.");
  });

  it("treats anything else as a blip", () => {
    expect(detailOr(new ApiError(500, "internal server error"), "fallback")).toBe("fallback");
    expect(detailOr(new ApiError(404, "not found"), "fallback")).toBe("fallback");
    expect(detailOr(new Error("network down"), "fallback")).toBe("fallback");
    expect(detailOr(undefined, "fallback")).toBe("fallback");
  });

  it("falls back when the server had no words", () => {
    expect(detailOr(new ApiError(409, ""), "fallback")).toBe("fallback");
  });
});
