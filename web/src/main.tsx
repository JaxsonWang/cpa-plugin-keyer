import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import "./styles.css";
import "./styles-reporting.css";
import "./styles-workspace.css";
import "./styles-refinements.css";
import "./styles-subscription-plans.css";
import { initThemeSync } from "./store/themeSync";
import { initLangSync } from "./i18n/langSync";

// initThemeSync 在 React 挂载前同步 CPA 内嵌主题或应用独立页偏好，避免首屏主题闪烁。
initThemeSync();

// initLangSync 在 React 挂载前同步面板语言，确保首屏直接使用目标语言。
initLangSync();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
