import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("./panelAuth", () => ({
  readPanelAuth: vi.fn(),
}));

import {
  bootstrapInitialSession,
  setSession,
  setViewerSession,
  clearSession,
  getSession,
  isAuthed,
  parseViewerLocation,
  subscribe,
  verifySession,
  viewerPath,
} from "./session";
import { readPanelAuth } from "./panelAuth";

beforeEach(() => {
  clearSession();
  window.history.replaceState(null, "", "/");
  localStorage.clear();
  vi.mocked(readPanelAuth).mockReset();
});

describe("session storage", () => {
  it("starts unauthenticated", () => {
    expect(isAuthed()).toBe(false);
    expect(getSession()).toBeNull();
  });

  it("stores base url and key in memory", () => {
    setSession("http://localhost:8317/", "secret-xyz");
    const s = getSession();
    expect(s).not.toBeNull();
    expect(s!.baseUrl).toBe("http://localhost:8317");
    expect(s!.secretKey).toBe("secret-xyz");
    expect(s!.mode).toBe("management");
    expect(isAuthed()).toBe(true);
  });

  it("adds http:// scheme when missing", () => {
    setSession("127.0.0.1:8317", "k");
    expect(getSession()!.baseUrl).toBe("http://127.0.0.1:8317");
  });

  it("preserves https://", () => {
    setSession("https://cpa.example.com/", "k");
    expect(getSession()!.baseUrl).toBe("https://cpa.example.com");
  });

  it("trims trailing slashes", () => {
    setSession("http://h:8317///", "k");
    expect(getSession()!.baseUrl).toBe("http://h:8317");
  });

  it("clears on logout", () => {
    setSession("http://h", "k");
    clearSession();
    expect(isAuthed()).toBe(false);
    expect(getSession()).toBeNull();
  });

  it("notifies subscribers on set and clear", () => {
    let calls = 0;
    const unsub = subscribe(() => calls++);
    setSession("http://h", "k");
    clearSession();
    expect(calls).toBeGreaterThanOrEqual(2);
    unsub();
  });

  it("is not authed when key empty", () => {
    setSession("http://h", "");
    expect(isAuthed()).toBe(false);
  });

  it("parses direct and panel viewer URLs without exposing the key outside the fragment", () => {
    expect(parseViewerLocation("#/key/cpa_direct/overview")).toEqual({ key: "cpa_direct", source: "direct" });
    expect(parseViewerLocation("#/overview", "#/plugin-pages/cpa-keyer/0/key/cpa_parent")).toEqual({
      key: "cpa_parent",
      source: "panel",
    });
    expect(parseViewerLocation("#/plugin-pages/other/0/key/cpa_wrong")).toBeNull();
  });

  it("keeps a viewer key in memory and builds refresh-safe direct routes", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const session = setViewerSession("https://cpa.example.com/", "cpa_viewer", "direct");
    expect(session.mode).toBe("viewer");
    expect(session.verified).toBe(false);
    expect(viewerPath()).toBe("/key/cpa_viewer");
    expect(viewerPath("/events")).toBe("/key/cpa_viewer/events");
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("verifies a viewer key against the read-only resource and binds its key id", async () => {
    setViewerSession("https://cpa.example.com", "cpa_viewer", "direct");
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ keys: [{ id: "team-a" }] }),
    } as Response));
    const session = await verifySession(fetchImpl as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://cpa.example.com/v0/resource/plugins/cpa-keyer/viewer/key",
      { headers: { Authorization: "Bearer cpa_viewer" } },
    );
    expect(session).toMatchObject({ mode: "viewer", keyID: "team-a", verified: true });
    expect(isAuthed()).toBe(true);
  });

  it("prioritizes a viewer URL and never falls back to saved management auth when it is rejected", async () => {
    window.location.hash = "#/key/cpa_invalid";
    vi.mocked(readPanelAuth).mockReturnValue({ apiBase: "https://admin.example.com", managementKey: "management" });
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401 } as Response));

    await expect(bootstrapInitialSession(fetchImpl as typeof fetch)).resolves.toBe("viewer-invalid");
    expect(readPanelAuth).not.toHaveBeenCalled();
    expect(getSession()).toMatchObject({ mode: "viewer", secretKey: "cpa_invalid", verified: false });
    expect(isAuthed()).toBe(false);
  });
});
