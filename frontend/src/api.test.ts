import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, SessionExpired, api, detailOr, onSessionExpired } from "./api";

// Plain literals rather than real Responses — request() reads only what
// these carry.
const jsonRes = (status: number, body: unknown) =>
  ({
    type: "basic",
    status,
    ok: status >= 200 && status < 300,
    statusText: "",
    json: () => Promise.resolve(body),
  }) as Response;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("expired-session detection", () => {
  it("throws SessionExpired on a 401 and notifies the subscriber", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes(401, { detail: "not signed in" })));
    const listener = vi.fn();
    const unsubscribe = onSessionExpired(listener);
    try {
      await expect(api.latestImport()).rejects.toBeInstanceOf(SessionExpired);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });

  it("is not an ApiError — no status branch may match it (the designer's 404 arm re-creates rows)", () => {
    expect(new SessionExpired()).not.toBeInstanceOf(ApiError);
  });

  it("me() reads a 401 as nobody signed in, without raising the expiry signal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes(401, { detail: "not signed in" })));
    const listener = vi.fn();
    const unsubscribe = onSessionExpired(listener);
    try {
      await expect(api.me()).resolves.toBeNull();
      expect(listener).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it("me() returns the signed-in user", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes(200, { id: 1, name: "Jason" })));
    await expect(api.me()).resolves.toEqual({ id: 1, name: "Jason" });
  });

  it("leaves real statuses alone — a 404 still throws ApiError(404)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes(404, { detail: "not found" })));
    await expect(api.latestImport()).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
    });
  });

  it("lets a rejected fetch pass through unwrapped", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("NetworkError")));
    const listener = vi.fn();
    const unsubscribe = onSessionExpired(listener);
    try {
      await expect(api.latestImport()).rejects.toBeInstanceOf(TypeError);
      expect(listener).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it("stops notifying after unsubscribe", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes(401, { detail: "not signed in" })));
    const listener = vi.fn();
    onSessionExpired(listener)();
    await expect(api.latestImport()).rejects.toBeInstanceOf(SessionExpired);
    expect(listener).not.toHaveBeenCalled();
  });
});

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
