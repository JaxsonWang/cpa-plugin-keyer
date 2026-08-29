import axios, { AxiosInstance } from "axios";
import { getSession, invalidateSession } from "../store/session";

// Build a fresh client per request using the current in-memory session.
// We avoid a singleton so that login/logout switches take effect immediately.
export function apiClient(): AxiosInstance {
  const s = getSession();
  if (!s || !s.baseUrl) {
    throw new Error("not authenticated");
  }
  const instance = axios.create({
    baseURL: s.baseUrl,
    headers: {
      Authorization: "Bearer " + s.secretKey,
      "Content-Type": "application/json",
    },
    // Treat 401/403 as session failure; viewer mode keeps its dedicated error state.
    validateStatus: (code) => code >= 200 && code < 300,
  });

  instance.interceptors.response.use(
    (r) => r,
    (err) => {
      if (err?.response?.status === 401 || err?.response?.status === 403) {
        invalidateSession();
      }
      return Promise.reject(err);
    },
  );

  return instance;
}

const PLUGIN_BASE = "/v0/management/plugins/cpa-keyer";
const VIEWER_BASE = "/v0/resource/plugins/cpa-keyer/viewer";
const VIEWER_PATHS: Readonly<Record<string, string>> = {
  "/keys": VIEWER_BASE + "/key",
  "/keys/usage": VIEWER_BASE + "/key/usage",
  "/usage/overview": VIEWER_BASE + "/usage/overview",
  "/usage/analysis": VIEWER_BASE + "/usage/analysis",
  "/usage/events": VIEWER_BASE + "/usage/events",
};

export function pluginPath(suffix: string): string {
  const session = getSession();
  if (session?.mode === "viewer") {
    const path = VIEWER_PATHS[suffix];
    if (!path) throw new Error("viewer session cannot access " + suffix);
    return path;
  }
  return PLUGIN_BASE + suffix;
}
