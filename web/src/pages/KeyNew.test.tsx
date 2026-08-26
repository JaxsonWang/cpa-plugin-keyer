import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetLocale } from "../i18n";
import { _resetKeyDrafts } from "../store/keyDraft";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../api/keys", () => ({ createKey: vi.fn() }));
vi.mock("../api/models", async () => {
  const actual = await vi.importActual<typeof import("../api/models")>("../api/models");
  return { ...actual, fetchCatalog: vi.fn() };
});
vi.mock("../store/modelPrices", async () => {
  const actual = await vi.importActual<typeof import("../store/modelPrices")>("../store/modelPrices");
  return {
    ...actual,
    getPriceTable: vi.fn().mockResolvedValue(null),
    refreshPriceTable: vi.fn(),
  };
});

import { fetchCatalog } from "../api/models";
import KeyNew from "./KeyNew";
import ModelPick from "./ModelPick";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  _resetLocale("zh-CN");
  _resetKeyDrafts();
  vi.mocked(fetchCatalog).mockResolvedValue([{ provider: "openai", model: "gpt-4o" }]);
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("KeyNew model-picker draft", () => {
  it("keeps Key ID and other entered fields after selecting models and returning", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <MemoryRouter initialEntries={["/keys/new"]}>
          <Routes>
            <Route path="/keys/new" element={<KeyNew />} />
            <Route path="/keys/new/models" element={<ModelPick />} />
          </Routes>
        </MemoryRouter>,
      );
      await tick();
    });

    const idInput = container.querySelectorAll<HTMLInputElement>('input[placeholder="例如 team-a"]')[0];
    const nameInput = container.querySelectorAll<HTMLInputElement>('input[placeholder="留空则用 ID"]')[0];
    await act(async () => {
      setInput(idInput, "team-a");
      setInput(nameInput, "Team A");
      await tick();
    });

    const addModel = container.querySelector<HTMLButtonElement>(".mc-add")!;
    await act(async () => {
      addModel.click();
      await tick();
    });

    const checkbox = container.querySelector<HTMLInputElement>('.model-pick-page input[type="checkbox"]')!;
    await act(async () => {
      checkbox.click();
      await tick();
    });
    const done = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.startsWith("完成（已选"))!;
    await act(async () => {
      done.click();
      await tick();
    });

    expect(container.querySelectorAll<HTMLInputElement>('input[placeholder="例如 team-a"]')[0].value).toBe("team-a");
    expect(container.querySelectorAll<HTMLInputElement>('input[placeholder="留空则用 ID"]')[0].value).toBe("Team A");
    expect(container.querySelector(".mc-chip")?.textContent).toContain("gpt-4o");
  });
});
