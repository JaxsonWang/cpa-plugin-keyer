import { Routes, Route, Navigate, useNavigate, Link, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { isAuthed, subscribe, clearSession, getSession, bootstrapFromPanel } from "./store/session";
import { useT } from "./i18n";
import Login from "./pages/Login";
import KeyList from "./pages/KeyList";
import KeyNew from "./pages/KeyNew";
import KeyEdit from "./pages/KeyEdit";
import KeyUsage from "./pages/KeyUsage";
import ModelPick from "./pages/ModelPick";

function useAuthTick() {
  const [, setTick] = useState(0);
  useEffect(() => subscribe(() => setTick((t) => t + 1)), []);
  return isAuthed();
}

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 42 42" aria-hidden="true">
      <path d="M10 8h17a7 7 0 0 1 0 14H16" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path d="M16 16v18M16 27h12" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <circle cx="30" cy="31" r="3" fill="currentColor" />
    </svg>
  );
}

function NavIcon({ name }: { name: "keys" | "new" | "logout" }) {
  if (name === "new") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
  }
  if (name === "logout") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10" /></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 11a4 4 0 1 1 3.7 4H4v-4h4ZM14 11h6M18 9v4" /></svg>;
}

// Desktop uses a compact operator-console sidebar. Mobile keeps the existing
// page headers and bottom tab bar to preserve one-handed interaction.
function TopNav() {
  const t = useT();
  const nav = useNavigate();
  const loc = useLocation();
  const s = getSession();
  if (!s) return null;
  // Active state: highlight the nav item matching the current path prefix.
  const onKeys = loc.pathname === "/keys" || loc.pathname.startsWith("/keys/");
  const onNew = loc.pathname === "/keys/new" || loc.pathname.startsWith("/keys/new/");
  return (
    <aside className="topnav">
      <div className="topnav-inner">
        <div className="topnav-brand">
          <BrandMark />
          <span className="tn-brand-copy">
            <span className="tn-title">cpa-keyer</span>
            <span className="tn-kicker">KEY ACCESS CONTROL</span>
          </span>
        </div>
        <div className="tn-connection">
          <span className="connection-dot" />
          <span><strong>{t("header.connected")}</strong><small>{s.baseUrl}</small></span>
        </div>
        <div className="topnav-actions">
          <Link to="/keys" className={"tn-link" + (onKeys && !onNew ? " active" : "")}><NavIcon name="keys" />{t("header.keyList")}</Link>
          <Link to="/keys/new" className={"tn-link" + (onNew ? " active" : "")}><NavIcon name="new" />{t("header.newKey")}</Link>
          <button
            className="tn-link tn-logout"
            onClick={() => { clearSession(); nav("/login"); }}
          >
            <NavIcon name="logout" />{t("header.logout")}
          </button>
        </div>
        <div className="tn-version">CPA PLUGIN · v0.6.1</div>
      </div>
    </aside>
  );
}

function WorkspaceHeader() {
  const t = useT();
  const location = useLocation();
  const path = location.pathname;
  const title = path.includes("/models")
    ? t("picker.title")
    : path.includes("/usage")
      ? t("keyUsage.title")
      : path.includes("/edit")
        ? t("edit.hTitle")
        : path.startsWith("/keys/new")
          ? t("header.newKey")
          : t("header.keyList");
  return (
    <header className="workspace-header mobile-hidden">
      <div>
        <span className="workspace-kicker">{t("header.workspaceKicker")}</span>
        <strong>{title}</strong>
      </div>
      <span className="workspace-status"><i /> {t("header.runtimeReady")}</span>
    </header>
  );
}

function Shell() {
  const authed = useAuthTick();
  const [bootstrapped, setBootstrapped] = useState(false);
  const t = useT();

  // When not yet authenticated, try once to reuse the panel's saved
  // management key (same-origin iframe embed). Only runs when not authed and
  // not already attempted, so a manual login or a successful bootstrap won't
  // re-trigger it.
  useEffect(() => {
    if (authed || bootstrapped) return;
    let alive = true;
    void bootstrapFromPanel().finally(() => {
      if (alive) setBootstrapped(true);
    });
    return () => {
      alive = false;
    };
  }, [authed, bootstrapped]);

  if (!authed) {
    if (!bootstrapped) {
      return <div className="app muted" style={{ padding: "40px 20px" }}>{t("session.restoring")}</div>;
    }
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  return (
    <div className="app">
      <TopNav />
      <main className="workspace">
        <WorkspaceHeader />
        <div className="workspace-content">
          <Routes>
            <Route path="/keys" element={<KeyList />} />
            <Route path="/keys/new" element={<KeyNew />} />
            <Route path="/keys/new/models" element={<ModelPick />} />
            <Route path="/keys/:id/edit" element={<KeyEdit />} />
            <Route path="/keys/:id/edit/models" element={<ModelPick />} />
            <Route path="/keys/:id/usage" element={<KeyUsage />} />
            <Route path="*" element={<Navigate to="/keys" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/*" element={<Shell />} />
    </Routes>
  );
}
