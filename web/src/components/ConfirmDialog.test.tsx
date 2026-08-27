import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetLocale } from "../i18n";
import ConfirmDialog from "./ConfirmDialog";

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
});

describe("ConfirmDialog", () => {
  it("focuses cancel for destructive actions and closes with Escape", async () => {
    const onCancel = vi.fn();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <ConfirmDialog
          open
          danger
          message="Delete this key?"
          confirmLabel="Delete"
          onConfirm={vi.fn()}
          onCancel={onCancel}
        />,
      );
      await tick();
    });
    expect(document.activeElement?.textContent).toBe("取消");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
