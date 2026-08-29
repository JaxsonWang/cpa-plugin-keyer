import { Routes, Route, Navigate, Link, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { Key, ListBullets, Plus, SquaresFour } from "@phosphor-icons/react";
import {
  bootstrapInitialSession,
  bootstrapViewerSession,
  getSession,
  isAuthed,
  isViewerSession,
  subscribe,
  parseViewerLocation,
  viewerPath,
  type ViewerSession,
} from "./store/session";
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
import { APP_VERSION } from "./version";

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
  const props = { "aria-hidden": true, size: 17, weight: "bold" as const };
  const icon = name === "new"
    ? <Plus {...props} />
    : name === "overview"
      ? <SquaresFour {...props} />
      : name === "events"
        ? <ListBullets {...props} />
        : <Key {...props} />;
  return <span className="nav-icon">{icon}</span>;
}

// Standalone desktop uses the same horizontal information architecture as the
// CPA-embedded surface. Mobile keeps the existing bottom tab bar for
// one-handed interaction.
function TopNav() {
  const t = useT();
  const loc = useLocation();
  const s = getSession();
  if (!s) return null;
  const viewer = isViewerSession(s);
  const detailPath = viewerPath();
  const overviewPath = viewer ? viewerPath("/overview") : "/overview";
  const eventsPath = viewer ? viewerPath("/events") : "/events";
  // Active state: highlight the nav item matching the current path prefix.
  const onKeys = loc.pathname === "/keys" || loc.pathname.startsWith("/keys/");
  const onNew = loc.pathname === "/keys/new" || loc.pathname.startsWith("/keys/new/");
  return (
    <header className="topnav">
      <div className="topnav-inner">
        <div className="topnav-brand">
          <BrandMark />
          <span className="tn-brand-copy">
            <span className="tn-title">Keyer</span>
            <span className="tn-kicker">KEY ACCESS CONTROL</span>
          </span>
        </div>
        {!viewer && (
          <div className="tn-connection">
            <span className="connection-dot" />
            <span><strong>{t("header.connected")}</strong><small>{s.baseUrl}</small></span>
          </div>
        )}
        <div className="topnav-actions">
          {viewer && <Link to={detailPath} className={"tn-link" + (loc.pathname === detailPath ? " active" : "")}><NavIcon name="keys" />{t("viewer.keyDetails")}</Link>}
          <Link to={overviewPath} className={"tn-link" + (loc.pathname === overviewPath ? " active" : "")}><NavIcon name="overview" />{t("usage.overviewTitle")}</Link>
          <Link to={eventsPath} className={"tn-link" + (loc.pathname === eventsPath ? " active" : "")}><NavIcon name="events" />{t("usage.eventsTitle")}</Link>
          {!viewer && <Link to="/keys" className={"tn-link" + (onKeys && !onNew ? " active" : "")}><NavIcon name="keys" />{t("header.keyList")}</Link>}
          {!viewer && <Link to="/keys/new" className={"tn-link" + (onNew ? " active" : "")}><NavIcon name="new" />{t("header.newKey")}</Link>}
        </div>
        <div className="tn-version">KEYER · v{APP_VERSION}</div>
      </div>
    </header>
  );
}

function SectionNav() {
  const t = useT();
  const location = useLocation();
  const viewer = isViewerSession(getSession());
  const detailPath = viewerPath();
  const overviewPath = viewer ? viewerPath("/overview") : "/overview";
  const eventsPath = viewer ? viewerPath("/events") : "/events";
  const onNew = location.pathname === "/keys/new" || location.pathname.startsWith("/keys/new/");
  const items: { to: string; label: string; icon: NavName; active: boolean }[] = viewer
    ? [
      { to: detailPath, label: t("viewer.keyDetails"), icon: "keys", active: location.pathname === detailPath },
      { to: overviewPath, label: t("usage.overviewTitle"), icon: "overview", active: location.pathname === overviewPath },
      { to: eventsPath, label: t("usage.eventsTitle"), icon: "events", active: location.pathname === eventsPath },
    ]
    : [
      { to: "/overview", label: t("usage.overviewTitle"), icon: "overview", active: location.pathname === "/overview" },
      { to: "/events", label: t("usage.eventsTitle"), icon: "events", active: location.pathname === "/events" },
      { to: "/keys", label: t("header.keyList"), icon: "keys", active: location.pathname.startsWith("/keys") && !onNew },
      { to: "/keys/new", label: t("header.newKey"), icon: "new", active: onNew },
    ];
  return (
    <nav className="section-nav" aria-label={t("usage.sectionNavigation")}>
      {items.map((item) => (
        <Link key={item.to} to={item.to} className={item.active ? "active" : ""}>
          <NavIcon name={item.icon} />
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}

function ViewerRoutes({ session }: { session: ViewerSession }) {
  const detailPath = viewerPath();
  const overviewPath = viewerPath("/overview");
  const eventsPath = viewerPath("/events");
  return (
    <Routes>
      <Route path={detailPath} element={<KeyUsage viewerKeyID={session.keyID} />} />
      <Route path={overviewPath} element={<UsageOverview />} />
      <Route path={eventsPath} element={<RequestEvents />} />
      <Route path="*" element={<Navigate to={detailPath} replace />} />
    </Routes>
  );
}

function ViewerInvalid() {
  const t = useT();
  return (
    <div className="login-page viewer-invalid-page">
      <div className="card lp-card">
        <h1>{t("viewer.invalidTitle")}</h1>
        <p className="muted">{t("viewer.invalidHint")}</p>
      </div>
    </div>
  );
}

function Shell() {
  const authed = useAuthTick();
  const [bootstrapped, setBootstrapped] = useState(false);
  const t = useT();
  const embedded = isEmbedded();
  const location = useLocation();
  const requestedViewer = parseViewerLocation(`#${location.pathname}`);
  const currentSession = getSession();
  const viewerMismatch = requestedViewer !== null && (
    !isViewerSession(currentSession) || currentSession.secretKey !== requestedViewer.key
  );
  const accessGranted = authed && !viewerMismatch;

  // A downstream-key URL always wins over panel management auth. An invalid
  // viewer key stays in viewer mode instead of falling back to broader access.
  useEffect(() => {
    if (bootstrapped && !viewerMismatch) return;
    let alive = true;
    if (viewerMismatch) setBootstrapped(false);
    const bootstrap = viewerMismatch && requestedViewer
      ? bootstrapViewerSession(requestedViewer)
      : bootstrapInitialSession();
    void bootstrap.finally(() => {
      if (alive) setBootstrapped(true);
    });
    return () => {
      alive = false;
    };
  }, [bootstrapped, requestedViewer?.key, requestedViewer?.source, viewerMismatch]);

  if (!accessGranted) {
    if (!bootstrapped || viewerMismatch) {
      return <div className="app muted" style={{ padding: "40px 20px" }}>{t("session.restoring")}</div>;
    }
    if (isViewerSession(getSession())) return <ViewerInvalid />;
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  const session = getSession();
  if (!session) return null;
  return (
    <div className={`app${embedded ? " is-embedded" : ""}${isViewerSession(session) ? " is-viewer" : ""}`}>
      <a className="skip-link" href="#keyer-main">{t("header.skipToContent")}</a>
      {!embedded && <TopNav />}
      <main id="keyer-main" className="workspace" tabIndex={-1}>
        <div className="workspace-content">
          <SectionNav />
          {isViewerSession(session) ? <ViewerRoutes session={session} /> : <Routes>
            <Route path="/keys" element={<KeyList />} />
            <Route path="/keys/new" element={<KeyNew />} />
            <Route path="/keys/new/models" element={<ModelPick />} />
            <Route path="/keys/:id/edit" element={<KeyEdit />} />
            <Route path="/keys/:id/edit/models" element={<ModelPick />} />
            <Route path="/keys/:id/usage" element={<KeyUsage />} />
            <Route path="/overview" element={<UsageOverview />} />
            <Route path="/analysis" element={<Navigate to="/overview" replace />} />
            <Route path="/events" element={<RequestEvents />} />
            <Route path="*" element={<Navigate to="/overview" replace />} />
          </Routes>}
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
