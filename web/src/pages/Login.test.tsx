import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetLocale } from "../i18n";
import { clearSession } from "../store/session";
import Login from "./Login";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  clearSession();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  clearSession();
  container.remove();
  vi.unstubAllGlobals();
});

describe("Login", () => {
  it("opens the overview after management authentication", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ enabled: true }),
    } as Response)));
    await act(async () => {
      root = createRoot(container);
      root.render(
        <MemoryRouter initialEntries={["/login"]}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/overview" element={<div data-testid="overview">Overview</div>} />
          </Routes>
        </MemoryRouter>,
      );
    });

    const secret = container.querySelector<HTMLInputElement>('input[type="password"]')!;
    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    await act(async () => {
      setInput(secret, "management-test");
      submit.click();
      await tick();
    });

    expect(container.querySelector('[data-testid="overview"]')).not.toBeNull();
  });
});
