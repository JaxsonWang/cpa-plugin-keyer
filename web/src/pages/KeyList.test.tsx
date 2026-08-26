import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KeyPublic } from "../types";
import { _resetLocale } from "../i18n";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../api/keys", () => ({
  listKeys: vi.fn(),
  deleteKey: vi.fn(),
  rotateKey: vi.fn(),
  resetRPM: vi.fn(),
  resetAllUsage: vi.fn(),
  resetKeyLimits: vi.fn(),
  setKeyEnabled: vi.fn(),
}));

import { listKeys, resetAllUsage, resetKeyLimits, setKeyEnabled } from "../api/keys";
import KeyList from "./KeyList";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function key(id: string, enabled = true): KeyPublic {
  return {
    id,
    name: `Key ${id}`,
    enabled,
    key_preview: `cpa_${id}...`,
    rpm: 60,
    models: [{ model: "gpt-5.4" }],
    daily_limit_usd: 10,
    weekly_limit_usd: 50,
    usage: {
      daily_usd: 1,
      weekly_usd: 3,
      daily_limit_usd: 10,
      weekly_limit_usd: 50,
    },
  };
}

async function renderList(keys: KeyPublic[]) {
  vi.mocked(listKeys).mockResolvedValue(keys);
  vi.mocked(setKeyEnabled).mockImplementation(async (id, enabled) => ({
    ...keys.find((item) => item.id === id)!,
    enabled,
  }));
  vi.mocked(resetKeyLimits).mockImplementation(async (id) => {
    const current = keys.find((item) => item.id === id)!;
    return {
      ...current,
      daily_limit_usd: 0,
      weekly_limit_usd: 0,
      usage: {
        ...current.usage,
        daily_limit_usd: 0,
        weekly_limit_usd: 0,
      },
    };
  });
  await act(async () => {
    root = createRoot(container);
    root.render(<MemoryRouter><KeyList /></MemoryRouter>);
    await tick();
  });
}

beforeEach(() => {
  _resetLocale("zh-CN");
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("KeyList", () => {
  it("renders keys in a desktop table with direct status switches", async () => {
    await renderList([key("team-a"), key("team-b", false)]);

    expect(container.querySelectorAll(".key-table tbody tr")).toHaveLength(2);
    expect(container.textContent).toContain("Key team-a");
    expect(container.textContent).toContain("Key team-b");
    expect(container.querySelector(".page-heading-title h1")?.textContent).toBe("Key 列表");
    expect(container.querySelector(".page-heading-title .runtime-status")?.textContent).toBe("运行正常");
    expect(container.querySelector(".overview-card.spend strong")?.textContent).toBe("$2.0");
    expect(container.querySelector(".key-usage-cell")?.textContent).toContain("$1.0 / $10.0");

    const toggle = container.querySelector<HTMLInputElement>(
      'input[aria-label="切换 Key team-a 状态"]',
    )!;
    await act(async () => {
      toggle.click();
      await tick();
    });

    expect(setKeyEnabled).toHaveBeenCalledWith("team-a", false);
    expect(toggle.checked).toBe(false);
  });

  it("disables selected keys in one batch action and clears successful selections", async () => {
    await renderList([key("team-a"), key("team-b")]);

    const teamA = container.querySelector<HTMLInputElement>('input[aria-label="选择 Key team-a"]')!;
    const teamB = container.querySelector<HTMLInputElement>('input[aria-label="选择 Key team-b"]')!;
    await act(async () => {
      teamA.click();
      teamB.click();
    });

    const batchDisable = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "批量禁用")!;
    await act(async () => {
      batchDisable.click();
      await tick();
    });

    expect(setKeyEnabled).toHaveBeenCalledWith("team-a", false);
    expect(setKeyEnabled).toHaveBeenCalledWith("team-b", false);
    expect(teamA.checked).toBe(false);
    expect(teamB.checked).toBe(false);
  });

  it("keeps failed batch items selected for retry", async () => {
    const keys = [key("team-a"), key("team-b")];
    await renderList(keys);
    vi.mocked(setKeyEnabled)
      .mockResolvedValueOnce({ ...keys[0], enabled: false })
      .mockRejectedValueOnce(new Error("persist failed"));

    const selectAll = container.querySelector<HTMLInputElement>('input[aria-label="全选"]')!;
    await act(async () => selectAll.click());
    const batchDisable = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "批量禁用")!;
    await act(async () => {
      batchDisable.click();
      await tick();
    });

    expect(container.querySelector<HTMLInputElement>('input[aria-label="选择 Key team-a"]')!.checked).toBe(false);
    expect(container.querySelector<HTMLInputElement>('input[aria-label="选择 Key team-b"]')!.checked).toBe(true);
    expect(container.textContent).toContain("1 个 Key 状态更新失败");
  });

  it("resets daily and weekly usage for all keys from the list header", async () => {
    vi.mocked(resetAllUsage).mockResolvedValue();
    await renderList([key("team-a"), key("team-b")]);

    const resetUsage = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "重置额度")!;
    await act(async () => {
      resetUsage.click();
      await tick();
    });

    const dialog = container.querySelector<HTMLElement>('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain("确认将所有 Key 的每日和每周已用额度归零？此操作不可撤销。");
    const confirmButton = Array.from(dialog.querySelectorAll("button"))
      .find((button) => button.textContent === "重置额度")!;
    await act(async () => {
      confirmButton.click();
      await tick();
    });

    expect(resetAllUsage).toHaveBeenCalledTimes(1);
    expect(listKeys).toHaveBeenCalledTimes(2);
  });

  it("resets one key's daily and weekly limits after confirmation", async () => {
    await renderList([key("team-a")]);

    const resetLimits = Array.from(container.querySelectorAll<HTMLButtonElement>(".key-table-actions button"))
      .find((button) => button.textContent === "重置")!;
    await act(async () => resetLimits.click());

    const dialog = container.querySelector<HTMLElement>('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain("每日用量上限和每周用量上限清零为 0");
    const confirmButton = Array.from(dialog.querySelectorAll("button"))
      .find((button) => button.textContent === "重置")!;
    await act(async () => {
      confirmButton.click();
      await tick();
    });

    expect(resetKeyLimits).toHaveBeenCalledWith("team-a");
    expect(container.querySelector(".key-usage-cell")?.textContent).toContain("不限");
  });

  it("resets selected keys' limits in one batch and clears successful selections", async () => {
    await renderList([key("team-a"), key("team-b")]);

    const selectAll = container.querySelector<HTMLInputElement>('input[aria-label="全选"]')!;
    await act(async () => selectAll.click());
    const batchReset = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "批量重置")!;
    await act(async () => batchReset.click());

    const dialog = container.querySelector<HTMLElement>('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain("已选 2 个 Key");
    const confirmButton = Array.from(dialog.querySelectorAll("button"))
      .find((button) => button.textContent === "批量重置")!;
    await act(async () => {
      confirmButton.click();
      await tick();
    });

    expect(resetKeyLimits).toHaveBeenCalledWith("team-a");
    expect(resetKeyLimits).toHaveBeenCalledWith("team-b");
    expect(container.querySelector<HTMLInputElement>('input[aria-label="选择 Key team-a"]')!.checked).toBe(false);
    expect(container.querySelector<HTMLInputElement>('input[aria-label="选择 Key team-b"]')!.checked).toBe(false);
  });

  it("keeps keys whose limit reset failed selected for retry", async () => {
    const keys = [key("team-a"), key("team-b")];
    await renderList(keys);
    vi.mocked(resetKeyLimits)
      .mockResolvedValueOnce({
        ...keys[0],
        daily_limit_usd: 0,
        weekly_limit_usd: 0,
        usage: { ...keys[0].usage, daily_limit_usd: 0, weekly_limit_usd: 0 },
      })
      .mockRejectedValueOnce(new Error("persist failed"));

    const selectAll = container.querySelector<HTMLInputElement>('input[aria-label="全选"]')!;
    await act(async () => selectAll.click());
    const batchReset = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "批量重置")!;
    await act(async () => batchReset.click());
    const confirmButton = Array.from(container.querySelectorAll<HTMLElement>('[role="alertdialog"] button'))
      .find((button) => button.textContent === "批量重置")!;
    await act(async () => {
      confirmButton.click();
      await tick();
    });

    expect(container.querySelector<HTMLInputElement>('input[aria-label="选择 Key team-a"]')!.checked).toBe(false);
    expect(container.querySelector<HTMLInputElement>('input[aria-label="选择 Key team-b"]')!.checked).toBe(true);
    expect(container.textContent).toContain("1 个 Key 的用量上限重置失败");
  });
});
