import { Routes, Route, Navigate, Link, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { Key, ListBullets, Plus, SquaresFour } from "@phosphor-icons/react";
import { isAuthed, subscribe, getSession, bootstrapFromPanel } from "./store/session";
import { isEmbedded } from "./store/panelAuth";
import { useT } from "./i18n";
import Login from "./pages/Login";
import KeyList from "./pages/KeyList";
import KeyNew from "./pages/KeyNew";
import KeyEdit from "./pages/KeyEdit";
import KeyUsage from "./pages/KeyUsage";
import ModelPick from "./pages/ModelPick";
import UsageOverview from "./pages/UsageOverview";
import RequestEvents from "./pages/RequestEvents";

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

type NavName = "keys" | "new" | "overview" | "events";

function NavIcon({ name }: { name: NavName }) {
  const props = { "aria-hidden": true, size: 18, weight: "regular" as const };
  if (name === "new") return <Plus {...props} />;
  if (name === "overview") return <SquaresFour {...props} />;
  if (name === "events") return <ListBullets {...props} />;
  return <Key {...props} />;
}

// Desktop uses a compact operator-console sidebar. Mobile keeps the existing
// page headers and bottom tab bar to preserve one-handed interaction.
function TopNav() {
  const t = useT();
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
            <span className="tn-title">Keyer</span>
            <span className="tn-kicker">KEY ACCESS CONTROL</span>
          </span>
        </div>
        <div className="tn-connection">
          <span className="connection-dot" />
          <span><strong>{t("header.connected")}</strong><small>{s.baseUrl}</small></span>
        </div>
        <div className="topnav-actions">
          <Link to="/overview" className={"tn-link" + (loc.pathname === "/overview" ? " active" : "")}><NavIcon name="overview" />{t("usage.overviewTitle")}</Link>
          <Link to="/events" className={"tn-link" + (loc.pathname === "/events" ? " active" : "")}><NavIcon name="events" />{t("usage.eventsTitle")}</Link>
          <Link to="/keys" className={"tn-link" + (onKeys && !onNew ? " active" : "")}><NavIcon name="keys" />{t("header.keyList")}</Link>
          <Link to="/keys/new" className={"tn-link" + (onNew ? " active" : "")}><NavIcon name="new" />{t("header.newKey")}</Link>
        </div>
        <div className="tn-version">KEYER · v0.7.2</div>
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
          : path === "/overview"
            ? t("usage.overviewTitle")
            : path === "/events"
              ? t("usage.eventsTitle")
          : t("header.keyList");
  return (
    <header className="workspace-header mobile-hidden">
      <div>
        <span className="workspace-kicker">{t("header.workspaceKicker")}</span>
        <strong>{title}</strong>
      </div>
    </header>
  );
}

function SectionNav() {
  const t = useT();
  const location = useLocation();
  const topLevel = ["/keys", "/overview", "/events"].includes(location.pathname);
  if (!topLevel) return null;
  const items: { to: string; label: string; icon: NavName }[] = [
    { to: "/overview", label: t("usage.overviewTitle"), icon: "overview" },
    { to: "/events", label: t("usage.eventsTitle"), icon: "events" },
    { to: "/keys", label: t("header.keyList"), icon: "keys" },
  ];
  return (
    <nav className="section-nav" aria-label={t("usage.sectionNavigation")}>
      {items.map((item) => (
        <Link key={item.to} to={item.to} className={location.pathname === item.to ? "active" : ""}>
          <NavIcon name={item.icon} />
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}

function Shell() {
  const authed = useAuthTick();
  const [bootstrapped, setBootstrapped] = useState(false);
  const t = useT();
  const embedded = isEmbedded();

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
    <div className={`app${embedded ? " is-embedded" : ""}`}>
      {!embedded && <TopNav />}
      <main className="workspace">
        {!embedded && <WorkspaceHeader />}
        <div className="workspace-content">
          <SectionNav />
          <Routes>
            <Route path="/keys" element={<KeyList />} />
            <Route path="/keys/new" element={<KeyNew />} />
            <Route path="/keys/new/models" element={<ModelPick />} />
            <Route path="/keys/:id/edit" element={<KeyEdit />} />
            <Route path="/keys/:id/edit/models" element={<ModelPick />} />
            <Route path="/keys/:id/usage" element={<KeyUsage />} />
            <Route path="/overview" element={<UsageOverview />} />
            <Route path="/analysis" element={<Navigate to="/overview" replace />} />
            <Route path="/events" element={<RequestEvents />} />
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
