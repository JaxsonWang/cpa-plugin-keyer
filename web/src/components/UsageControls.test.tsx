import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import UsageControls from "./UsageControls";
import { clearSession, setViewerSession } from "../store/session";
import { _resetLocale } from "../i18n";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  _resetLocale("zh-CN");
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  clearSession();
  container.remove();
});

describe("UsageControls", () => {
  it("hides the cross-key selector in viewer mode", async () => {
    setViewerSession("https://cpa.example.com", "cpa_viewer", "direct");
    await act(async () => {
      root = createRoot(container);
      root.render(
        <UsageControls
          range="7d"
          keyID="team-a"
          filters={{
            key_ids: ["team-a"], providers: [], models: [], executor_types: [],
            auth_types: [], sources: [], service_tiers: [], status_codes: [],
          }}
          onRangeChange={vi.fn()}
          onKeyChange={vi.fn()}
          onRefresh={vi.fn()}
        />,
      );
    });

    expect(container.querySelector('select[aria-label="时间范围"]')).not.toBeNull();
    expect(container.querySelector('select[aria-label="Key ID"]')).toBeNull();
  });
});
