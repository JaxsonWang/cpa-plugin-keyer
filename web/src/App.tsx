import { Routes, Route, Navigate, Link, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { CalendarCheck, Key, ListBullets, Plus, SquaresFour } from "@phosphor-icons/react";
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
import SubscriptionPlans from "./pages/SubscriptionPlans";
import SubscriptionPlanEdit from "./pages/SubscriptionPlanEdit";
import { APP_VERSION } from "./version";
import ThemeControl from "./components/ThemeControl";

/**
 * 订阅认证状态变化并返回当前认证结果。
 * @returns 返回当前会话是否已经通过认证。
 */
function useAuthTick() {
  // setTick 通过递增内部计数触发认证状态重渲染，计数值本身不使用。
  const [, setTick] = useState(0);
  // 以下副作用订阅会话变化；递增回调中的 t 表示当前计数，返回值负责取消订阅。
  useEffect(() => subscribe(() => setTick((t) => t + 1)), []);
  return isAuthed();
}

/**
 * 渲染 Keyer 品牌标记。
 * @returns 返回导航栏使用的矢量标记。
 */
function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 42 42" aria-hidden="true">
      <path d="M10 8h17a7 7 0 0 1 0 14H16" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path d="M16 16v18M16 27h12" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <circle cx="30" cy="31" r="3" fill="currentColor" />
    </svg>
  );
}

/** NavName 限定主导航支持的业务入口。 */
type NavName = "keys" | "new" | "overview" | "events" | "plans";

/** 表示导航图标组件需要的入口名称。 */
type NavIconProps = {
  /** name 指定需要渲染的业务入口图标。 */
  name: NavName;
};

/** 表示一个可渲染的主导航入口。 */
type NavigationItem = {
  /** to 是入口对应的路由路径。 */
  to: string;
  /** label 是当前语言下的入口名称。 */
  label: string;
  /** icon 指定入口使用的图标。 */
  icon: NavName;
  /** active 表示当前路由是否选中该入口。 */
  active: boolean;
};

/**
 * 渲染统一的主导航图标容器。
 * @param name 表示当前导航入口名称。
 * @returns 返回与 CPA 内嵌导航一致的图标节点。
 */
function NavIcon({ name }: NavIconProps) {
  // props 保存所有导航图标共享的无障碍和尺寸属性。
  const props = { "aria-hidden": true, size: 17, weight: "bold" as const };
  // icon 保存当前入口对应的 Phosphor 图标。
  const icon = name === "new"
    ? <Plus {...props} />
    : name === "plans"
      ? <CalendarCheck {...props} />
      : name === "overview"
        ? <SquaresFour {...props} />
        : name === "events"
          ? <ListBullets {...props} />
          : <Key {...props} />;
  return <span className="nav-icon">{icon}</span>;
}

/**
 * 渲染独立页桌面导航；导航项视觉规则与 CPA 内嵌导航共用。
 * @returns 返回包含品牌、连接状态、业务入口、主题和版本的导航栏。
 */
function TopNav() {
  // t 负责读取当前语言的界面文案。
  const t = useT();
  // loc 保存当前路由位置，用于计算导航选中态。
  const loc = useLocation();
  // s 保存当前管理或 Viewer 会话。
  const s = getSession();
  if (!s) return null;
  // viewer 表示当前是否为单 Key Viewer 会话。
  const viewer = isViewerSession(s);
  // detailPath 是 Viewer 的 Key 详情路径。
  const detailPath = viewerPath();
  // overviewPath 是当前会话可访问的概览路径。
  const overviewPath = viewer ? viewerPath("/overview") : "/overview";
  // eventsPath 是当前会话可访问的请求事件路径。
  const eventsPath = viewer ? viewerPath("/events") : "/events";
  // onKeys 表示当前路径是否属于 Key 管理流程。
  const onKeys = loc.pathname === "/keys" || loc.pathname.startsWith("/keys/");
  // onNew 表示当前路径是否属于新建 Key 流程。
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
          {!viewer && <Link to="/plans" className={"tn-link" + (loc.pathname.startsWith("/plans") ? " active" : "")}><NavIcon name="plans" />{t("plans.title")}</Link>}
          {!viewer && <Link to="/keys" className={"tn-link" + (onKeys && !onNew ? " active" : "")}><NavIcon name="keys" />{t("header.keyList")}</Link>}
          {!viewer && <Link to="/keys/new" className={"tn-link" + (onNew ? " active" : "")}><NavIcon name="new" />{t("header.newKey")}</Link>}
        </div>
        <ThemeControl />
        <div className="tn-version">KEYER · v{APP_VERSION}</div>
      </div>
    </header>
  );
}

/**
 * 渲染 CPA 内嵌页的业务导航。
 * @returns 返回与独立页业务导航共用视觉规则的导航节点。
 */
function SectionNav() {
  // t 负责读取当前语言的界面文案。
  const t = useT();
  // location 保存当前路由位置，用于计算导航选中态。
  const location = useLocation();
  // viewer 表示当前是否为单 Key Viewer 会话。
  const viewer = isViewerSession(getSession());
  // detailPath 是 Viewer 的 Key 详情路径。
  const detailPath = viewerPath();
  // overviewPath 是当前会话可访问的概览路径。
  const overviewPath = viewer ? viewerPath("/overview") : "/overview";
  // eventsPath 是当前会话可访问的请求事件路径。
  const eventsPath = viewer ? viewerPath("/events") : "/events";
  // onNew 表示当前路径是否属于新建 Key 流程。
  const onNew = location.pathname === "/keys/new" || location.pathname.startsWith("/keys/new/");
  // items 保存当前会话允许展示的导航入口。
  const items: NavigationItem[] = viewer
    ? [
      { to: detailPath, label: t("viewer.keyDetails"), icon: "keys", active: location.pathname === detailPath },
      { to: overviewPath, label: t("usage.overviewTitle"), icon: "overview", active: location.pathname === overviewPath },
      { to: eventsPath, label: t("usage.eventsTitle"), icon: "events", active: location.pathname === eventsPath },
    ]
    : [
      { to: "/overview", label: t("usage.overviewTitle"), icon: "overview", active: location.pathname === "/overview" },
      { to: "/events", label: t("usage.eventsTitle"), icon: "events", active: location.pathname === "/events" },
      { to: "/plans", label: t("plans.title"), icon: "plans", active: location.pathname.startsWith("/plans") },
      { to: "/keys", label: t("header.keyList"), icon: "keys", active: location.pathname.startsWith("/keys") && !onNew },
      { to: "/keys/new", label: t("header.newKey"), icon: "new", active: onNew },
    ];
  return (
    <nav className="section-nav" aria-label={t("usage.sectionNavigation")}>
      {/* item 表示当前渲染的导航入口。 */}
      {items.map((item) => (
        <Link key={item.to} to={item.to} className={item.active ? "active" : ""}>
          <NavIcon name={item.icon} />
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}

/** 表示 Viewer 路由组件需要的已认证会话。 */
type ViewerRoutesProps = {
  /** session 保存当前下游 Key 的 Viewer 会话。 */
  session: ViewerSession;
};

/**
 * 渲染 Viewer 只读路由集合。
 * @param session 表示当前 Viewer 会话。
 * @returns 返回当前 Key 可访问的详情、概览和事件路由。
 */
function ViewerRoutes({ session }: ViewerRoutesProps) {
  // detailPath 是当前 Key 的详情路径。
  const detailPath = viewerPath();
  // overviewPath 是当前 Key 的概览路径。
  const overviewPath = viewerPath("/overview");
  // eventsPath 是当前 Key 的请求事件路径。
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

/**
 * 渲染无效 Viewer Key 的独立错误页。
 * @param embedded 表示页面是否运行在 CPA 内嵌环境。
 * @returns 返回失效说明，并仅在独立页展示主题控制。
 */
function ViewerInvalid({ embedded }: { embedded: boolean }) {
  // t 负责读取当前语言的界面文案。
  const t = useT();
  return (
    <>
      {!embedded && <ThemeControl floating />}
      <div className="login-page viewer-invalid-page">
        <div className="card lp-card">
          <h1>{t("viewer.invalidTitle")}</h1>
          <p className="muted">{t("viewer.invalidHint")}</p>
        </div>
      </div>
    </>
  );
}

/**
 * 装配认证恢复、独立/内嵌外壳和业务路由。
 * @returns 返回当前会话状态对应的完整应用外壳。
 */
function Shell() {
  // authed 表示当前会话是否通过认证。
  const authed = useAuthTick();
  // bootstrapped 表示初始会话恢复是否结束；setBootstrapped 更新恢复状态。
  const [bootstrapped, setBootstrapped] = useState(false);
  // t 负责读取当前语言的界面文案。
  const t = useT();
  // embedded 表示页面是否运行在 CPA 内嵌环境。
  const embedded = isEmbedded();
  // location 保存当前路由位置。
  const location = useLocation();
  // requestedViewer 保存 URL 中解析出的 Viewer Key 请求。
  const requestedViewer = parseViewerLocation(`#${location.pathname}`);
  // currentSession 保存恢复前的当前会话。
  const currentSession = getSession();
  // viewerMismatch 表示 URL Viewer Key 与当前会话不一致。
  const viewerMismatch = requestedViewer !== null && (
    !isViewerSession(currentSession) || currentSession.secretKey !== requestedViewer.key
  );
  // accessGranted 表示认证状态与 URL 会话边界均允许进入业务页。
  const accessGranted = authed && !viewerMismatch;

  // 以下副作用优先恢复 URL 指定的 Viewer 会话，失效 Key 不回退到管理权限。
  useEffect(() => {
    if (bootstrapped && !viewerMismatch) return;
    // alive 表示当前外壳仍然挂载。
    let alive = true;
    if (viewerMismatch) setBootstrapped(false);
    // bootstrap 保存本轮管理或 Viewer 会话恢复任务。
    const bootstrap = viewerMismatch && requestedViewer
      ? bootstrapViewerSession(requestedViewer)
      : bootstrapInitialSession();
    // 以下完成回调仅在组件仍挂载时结束恢复状态。
    void bootstrap.finally(() => {
      if (alive) setBootstrapped(true);
    });
    // 以下清理回调阻止卸载后的状态更新。
    return () => {
      alive = false;
    };
  }, [bootstrapped, requestedViewer?.key, requestedViewer?.source, viewerMismatch]);

  if (!accessGranted) {
    if (!bootstrapped || viewerMismatch) {
      return <div className="app muted" style={{ padding: "40px 20px" }}>{t("session.restoring")}</div>;
    }
    if (isViewerSession(getSession())) return <ViewerInvalid embedded={embedded} />;
    return (
      <>
        {!embedded && <ThemeControl floating />}
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </>
    );
  }
  // session 保存已经通过边界检查的当前会话。
  const session = getSession();
  if (!session) return null;
  return (
    <div className={`app${embedded ? " is-embedded" : ""}${isViewerSession(session) ? " is-viewer" : ""}`}>
      <a className="skip-link" href="#keyer-main">{t("header.skipToContent")}</a>
      {!embedded && <TopNav />}
      {!embedded && <div className="mobile-only theme-mobile-slot"><ThemeControl /></div>}
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
            <Route path="/plans" element={<SubscriptionPlans />} />
            <Route path="/plans/new" element={<SubscriptionPlanEdit />} />
            <Route path="/plans/:id/edit" element={<SubscriptionPlanEdit />} />
            <Route path="*" element={<Navigate to="/overview" replace />} />
          </Routes>}
        </div>
      </main>
    </div>
  );
}

/**
 * 渲染 Keyer 应用根路由。
 * @returns 返回承载完整业务外壳的路由集合。
 */
export default function App() {
  return (
    <Routes>
      <Route path="/*" element={<Shell />} />
    </Routes>
  );
}
