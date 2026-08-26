import { useEffect, useRef } from "react";
import { init, type ECharts, type EChartsCoreOption } from "../charts/echarts";

export interface ChartPalette {
  accent: string;
  accentStrong: string;
  border: string;
  danger: string;
  muted: string;
  ok: string;
  panel: string;
  reducedMotion: boolean;
  text: string;
  warn: string;
}

interface EChartProps {
  ariaLabel: string;
  buildOption: (palette: ChartPalette) => EChartsCoreOption;
  className?: string;
}

function token(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  return styles.getPropertyValue(name).trim() || fallback;
}

function readPalette(): ChartPalette {
  const styles = getComputedStyle(document.documentElement);
  return {
    accent: token(styles, "--accent-2", "#7f7a74"),
    accentStrong: token(styles, "--accent-3", "#726d67"),
    border: token(styles, "--border", "#e3e1db"),
    danger: token(styles, "--danger", "#c65746"),
    muted: token(styles, "--muted", "#6d6760"),
    ok: token(styles, "--ok", "#10b981"),
    panel: token(styles, "--panel", "#ffffff"),
    reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    text: token(styles, "--text", "#2d2a26"),
    warn: token(styles, "--warn", "#e0aa14"),
  };
}

export default function EChart({ ariaLabel, buildOption, className = "" }: EChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ECharts | null>(null);
  const buildOptionRef = useRef(buildOption);
  buildOptionRef.current = buildOption;

  const render = () => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setOption(buildOptionRef.current(readPalette()), { notMerge: true });
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = init(container, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    render();

    // Use constructors from the chart container's own DOM realm. The plugin
    // runs inside a same-origin CPA iframe, where cross-realm observers reject
    // Nodes from the other document even though both origins match.
    const ownerWindow = container.ownerDocument.defaultView ?? window;
    const ResizeObserverConstructor = ownerWindow.ResizeObserver ?? ResizeObserver;
    const resizeObserver = new ResizeObserverConstructor(() => chart.resize());
    resizeObserver.observe(container);
    const themeObserver = new ownerWindow.MutationObserver(() => render());
    themeObserver.observe(container.ownerDocument.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      themeObserver.disconnect();
      resizeObserver.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    render();
  }, [buildOption]);

  return <div ref={containerRef} className={`echart ${className}`.trim()} role="img" aria-label={ariaLabel} />;
}
