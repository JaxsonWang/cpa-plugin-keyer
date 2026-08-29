// All credentials stay in memory. Management and downstream viewer keys are
// never written to localStorage by this application.

import { readPanelAuth } from "./panelAuth";
import type { StatusResponse } from "../types";

export type SessionMode = "management" | "viewer";
export type ViewerSource = "direct" | "panel";

interface BaseSession {
  baseUrl: string;
  secretKey: string;
  mode: SessionMode;
}

export interface ManagementSession extends BaseSession {
  mode: "management";
}

export interface ViewerSession extends BaseSession {
  mode: "viewer";
  keyID: string;
  routeBase: string;
  verified: boolean;
}

export type Session = ManagementSession | ViewerSession;

export interface ViewerLocation {
  key: string;
  source: ViewerSource;
}

export type BootstrapResult = "management" | "viewer" | "viewer-invalid" | "none";

let current: Session | null = null;

const listeners = new Set<() => void>();

function normalizeBase(url: string): string {
  let u = url.trim();
  if (u === "") return "";
  u = u.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(u)) u = "http://" + u;
  return u;
}

function decodeViewerKey(value: string): string | null {
  try {
    const key = decodeURIComponent(value).trim();
    return key === "" ? null : key;
  } catch {
    return null;
  }
}

function matchViewerKey(hash: string, pattern: RegExp): string | null {
  const match = hash.trim().match(pattern);
  return match ? decodeViewerKey(match[1]) : null;
}

// Direct resource URL: index.html#/key/<KEY>[/overview|/events].
// Panel URL: management.html#/plugin-pages/cpa-keyer/0/key/<KEY>.
export function parseViewerLocation(currentHash: string, parentHash = ""): ViewerLocation | null {
  const direct = matchViewerKey(currentHash, /^#?\/key\/([^/?#]+)(?:[/?#]|$)/);
  if (direct) return { key: direct, source: "direct" };

  const panelPattern = /^#?\/plugin-pages\/cpa-keyer\/[^/]+\/key\/([^/?#]+)(?:[/?#]|$)/;
  const currentPanel = matchViewerKey(currentHash, panelPattern);
  if (currentPanel) return { key: currentPanel, source: "panel" };

  const parentPanel = matchViewerKey(parentHash, panelPattern);
  return parentPanel ? { key: parentPanel, source: "panel" } : null;
}

export function readViewerLocation(): ViewerLocation | null {
  if (typeof window === "undefined") return null;
  let parentHash = "";
  try {
    if (window.self !== window.top) parentHash = window.parent.location.hash;
  } catch {
    parentHash = "";
  }
  return parseViewerLocation(window.location.hash, parentHash);
}

export function setSession(baseUrl: string, secretKey: string): ManagementSession {
  const session: ManagementSession = {
    baseUrl: normalizeBase(baseUrl),
    secretKey: secretKey.trim(),
    mode: "management",
  };
  current = session;
  emit();
  return session;
}

export function setViewerSession(baseUrl: string, secretKey: string, source: ViewerSource): ViewerSession {
  const key = secretKey.trim();
  const session: ViewerSession = {
    baseUrl: normalizeBase(baseUrl),
    secretKey: key,
    mode: "viewer",
    keyID: "",
    routeBase: source === "direct" ? `/key/${encodeURIComponent(key)}` : "",
    verified: false,
  };
  current = session;
  emit();
  return session;
}

export function clearSession(): void {
  current = null;
  emit();
}

export function invalidateSession(): void {
  if (current?.mode === "viewer") {
    current = { ...current, verified: false };
    emit();
    return;
  }
  clearSession();
}

export function getSession(): Session | null {
  return current;
}

export function isViewerSession(session: Session | null = current): session is ViewerSession {
  return session?.mode === "viewer";
}

export function viewerPath(suffix = ""): string {
  if (!isViewerSession(current)) return suffix || "/";
  const path = current.routeBase + suffix;
  return path || "/";
}

export function isAuthed(): boolean {
  if (!current || current.secretKey === "" || current.baseUrl === "") return false;
  return current.mode === "management" || current.verified;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  for (const fn of listeners) fn();
}

// Attempt to restore the official panel's saved management key. Viewer URLs
// are handled before this function and therefore never fall back to a broader
// management session after a downstream key is rejected.
export async function bootstrapFromPanel(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const auth = readPanelAuth();
  if (!auth) return false;
  setSession(auth.apiBase, auth.managementKey);
  try {
    await verifySession(fetchImpl);
    return true;
  } catch {
    clearSession();
    return false;
  }
}

export async function bootstrapInitialSession(fetchImpl: typeof fetch = fetch): Promise<BootstrapResult> {
  const viewer = readViewerLocation();
  if (viewer) return bootstrapViewerSession(viewer, fetchImpl);
  if (isAuthed()) return current?.mode ?? "none";
  return await bootstrapFromPanel(fetchImpl) ? "management" : "none";
}

export async function bootstrapViewerSession(
  viewer: ViewerLocation,
  fetchImpl: typeof fetch = fetch,
): Promise<"viewer" | "viewer-invalid"> {
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  setViewerSession(baseUrl, viewer.key, viewer.source);
  try {
    await verifySession(fetchImpl);
    return "viewer";
  } catch {
    return "viewer-invalid";
  }
}

// Management sessions probe the protected status route. Viewer sessions probe
// the read-only key resource and bind the session to the key id returned by the
// server; callers never supply that id as an authorization boundary.
export async function verifySession(fetchImpl: typeof fetch): Promise<Session> {
  const session = current;
  if (!session) throw new Error("no session");

  if (session.mode === "management") {
    const res = await fetchImpl(session.baseUrl + "/v0/management/plugins/cpa-keyer/status", {
      headers: { Authorization: "Bearer " + session.secretKey },
    });
    if (!res.ok) throw new Error("management key rejected (" + res.status + ")");
    await res.json() as StatusResponse;
    return session;
  }

  const res = await fetchImpl(session.baseUrl + "/v0/resource/plugins/cpa-keyer/viewer/key", {
    headers: { Authorization: "Bearer " + session.secretKey },
  });
  if (!res.ok) throw new Error("viewer key rejected (" + res.status + ")");
  const payload = await res.json() as { keys?: { id?: string }[] };
  const keyID = payload.keys?.[0]?.id?.trim() ?? "";
  if (!keyID) throw new Error("viewer key response is invalid");

  const verified: ViewerSession = { ...session, keyID, verified: true };
  if (current === session) {
    current = verified;
    emit();
  }
  return verified;
}
