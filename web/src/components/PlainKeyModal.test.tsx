import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetLocale } from "../i18n";
import PlainKeyModal from "./PlainKeyModal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  _resetLocale("zh-CN");
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("PlainKeyModal", () => {
  it("requires an explicit close and reports copy success", async () => {
    const onClose = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await act(async () => {
      root = createRoot(container);
      root.render(<PlainKeyModal plainKey="cpa_secret" onClose={onClose} />);
      await tick();
    });

    expect(container.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();
    container.querySelector<HTMLElement>(".modal-overlay")!.click();
    expect(onClose).not.toHaveBeenCalled();

    const copyButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))[0];
    await act(async () => {
      copyButton.click();
      await tick();
    });
    expect(writeText).toHaveBeenCalledWith("cpa_secret");
    expect(container.querySelector('[role="status"]')?.textContent).toBe("已复制");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows an actionable message when clipboard access fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("blocked")) },
    });
    await act(async () => {
      root = createRoot(container);
      root.render(<PlainKeyModal plainKey="cpa_secret" onClose={vi.fn()} />);
      await tick();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")!.click();
      await tick();
    });
    expect(container.querySelector('[role="status"]')?.textContent).toContain("请手动选择");
  });
});
