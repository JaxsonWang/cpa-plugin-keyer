import { beforeEach, describe, expect, it } from "vitest";
import { pluginPath } from "./client";
import { clearSession, setSession, setViewerSession } from "../store/session";

beforeEach(() => clearSession());

describe("pluginPath", () => {
  it("uses management routes for management sessions", () => {
    setSession("https://cpa.example.com", "management");
    expect(pluginPath("/keys")).toBe("/v0/management/plugins/cpa-keyer/keys");
  });

  it("maps every viewer read route to an unauthenticated resource route", () => {
    setViewerSession("https://cpa.example.com", "cpa_viewer", "direct");
    expect(pluginPath("/keys")).toBe("/v0/resource/plugins/cpa-keyer/viewer/key");
    expect(pluginPath("/keys/usage")).toBe("/v0/resource/plugins/cpa-keyer/viewer/key/usage");
    expect(pluginPath("/usage/overview")).toBe("/v0/resource/plugins/cpa-keyer/viewer/usage/overview");
    expect(pluginPath("/usage/analysis")).toBe("/v0/resource/plugins/cpa-keyer/viewer/usage/analysis");
    expect(pluginPath("/usage/events")).toBe("/v0/resource/plugins/cpa-keyer/viewer/usage/events");
  });

  it("rejects write routes before a viewer request is sent", () => {
    setViewerSession("https://cpa.example.com", "cpa_viewer", "direct");
    expect(() => pluginPath("/keys/rotate")).toThrow("viewer session cannot access /keys/rotate");
    expect(() => pluginPath("/keys/reset-usage")).toThrow("viewer session cannot access /keys/reset-usage");
  });
});
