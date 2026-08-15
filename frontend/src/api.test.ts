import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, SessionExpired, api, detailOr, onSessionExpired } from "./api";

// undici's Response can't fabricate an opaqueredirect (a 3xx status throws in
// the constructor, and Response.redirect() reports type "default"), so the
// stubs are plain literals — request() reads only what these carry.
const opaqueredirect = { type: "opaqueredirect", status: 0, ok: false } as Response;
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
  it("throws SessionExpired on an opaqueredirect and notifies the subscriber", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(opaqueredirect));
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

  it("requests with redirect manual, so the login 302 is visible at all", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes(200, null));
    vi.stubGlobal("fetch", fetchMock);
    await api.latestImport();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/imports/latest",
      expect.objectContaining({ redirect: "manual" })
    );
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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(opaqueredirect));
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
