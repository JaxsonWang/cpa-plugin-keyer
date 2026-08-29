import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSession, setViewerSession } from "../store/session";
import { _resetLocale } from "../i18n";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../api/keys", () => ({ fetchKeyUsage: vi.fn() }));

import { fetchKeyUsage } from "../api/keys";
import KeyUsage from "./KeyUsage";

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
  vi.clearAllMocks();
});

describe("KeyUsage viewer", () => {
  it("loads only the authenticated key id and hides management actions", async () => {
    setViewerSession("https://cpa.example.com", "cpa_viewer", "direct");
    vi.mocked(fetchKeyUsage).mockResolvedValue({
      key_id: "team-a",
      key_name: "Team A",
      daily_limit_usd: 10,
      weekly_limit_usd: 50,
      models: [],
    });

    await act(async () => {
      root = createRoot(container);
      root.render(
        <MemoryRouter initialEntries={["/key/cpa_viewer"]}>
          <KeyUsage viewerKeyID="team-a" />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchKeyUsage).toHaveBeenCalledWith("team-a");
    expect(container.textContent).toContain("team-a");
    expect(container.textContent).toContain("Team A");
    expect(container.querySelector('a[href="/keys"]')).toBeNull();
    expect(container.querySelector('a[href$="/edit"]')).toBeNull();
  });
});
