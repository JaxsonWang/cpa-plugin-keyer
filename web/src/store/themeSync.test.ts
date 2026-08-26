import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  initThemeSync,
  _resolveParentTheme,
  _teardownThemeSync,
} from "./themeSync";

// The resolver reads window.parent.document.documentElement[data-theme].
// jsdom gives us a real document, but no separate "parent" document by default.
// We stub window.parent.document with a fake whose documentElement is a real
// detached element we control, and toggle window.self/top for embedded state.

const realSelf = window.self;
const realTop = window.top;
let realParentDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  _teardownThemeSync();
  Object.defineProperty(window, "self", { value: realSelf, configurable: true });
  Object.defineProperty(window, "top", { value: realTop, configurable: true });
  if (realParentDescriptor) {
    Object.defineProperty(window, "parent", realParentDescriptor);
  }
});

function setEmbedded(embedded: boolean, parentHtml: HTMLElement) {
  Object.defineProperty(window, "self", { value: window, configurable: true });
  Object.defineProperty(window, "top", {
    value: embedded ? ({} as Window) : window,
    configurable: true,
  });
  // window.parent.document.documentElement must return parentHtml.
  realParentDescriptor = Object.getOwnPropertyDescriptor(window, "parent");
  Object.defineProperty(window, "parent", {
    configurable: true,
    get: () => ({
      document: {
        documentElement: parentHtml,
      },
    }),
  });
}

describe("themeSync resolver", () => {
  it("returns null when not embedded (standalone page)", () => {
    setEmbedded(false, document.documentElement); // not used, not embedded
    expect(_resolveParentTheme()).toBeNull();
  });

  it("reads 'white' from parent html data-theme", () => {
    const parentHtml = document.createElement("html");
    parentHtml.setAttribute("data-theme", "white");
    setEmbedded(true, parentHtml);
    expect(_resolveParentTheme()).toBe("white");
  });

  it("reads 'dark' from parent html data-theme", () => {
    const parentHtml = document.createElement("html");
    parentHtml.setAttribute("data-theme", "dark");
    setEmbedded(true, parentHtml);
    expect(_resolveParentTheme()).toBe("dark");
  });

  it("treats absent data-theme as 'light' (panel greige)", () => {
    const parentHtml = document.createElement("html");
    setEmbedded(true, parentHtml);
    expect(_resolveParentTheme()).toBe("light");
  });

  it("treats an unknown data-theme value as 'light'", () => {
    const parentHtml = document.createElement("html");
    parentHtml.setAttribute("data-theme", "auto"); // panel never sets this on DOM, but be safe
    setEmbedded(true, parentHtml);
    expect(_resolveParentTheme()).toBe("light");
  });
});

describe("initThemeSync apply", () => {
  it("applies white to self html when parent is white", () => {
    const parentHtml = document.createElement("html");
    parentHtml.setAttribute("data-theme", "white");
    setEmbedded(true, parentHtml);
    initThemeSync();
    expect(document.documentElement.getAttribute("data-theme")).toBe("white");
  });

  it("applies dark to self html when parent is dark", () => {
    const parentHtml = document.createElement("html");
    parentHtml.setAttribute("data-theme", "dark");
    setEmbedded(true, parentHtml);
    initThemeSync();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("removes data-theme on self when parent is light (no attribute)", () => {
    const parentHtml = document.createElement("html");
    setEmbedded(true, parentHtml);
    // Pre-set a stale attribute to prove it gets cleared.
    document.documentElement.setAttribute("data-theme", "dark");
    initThemeSync();
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });

  it("falls back to light (no attribute) when standalone", () => {
    setEmbedded(false, document.documentElement);
    document.documentElement.setAttribute("data-theme", "dark");
    initThemeSync();
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });

  it("reacts to a storage event on cli-proxy-theme", () => {
    const parentHtml = document.createElement("html");
    setEmbedded(true, parentHtml);
    initThemeSync();
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();

    // Simulate panel flipping to dark and re-applying to its DOM.
    parentHtml.setAttribute("data-theme", "dark");
    window.dispatchEvent(
      new StorageEvent("storage", { key: "cli-proxy-theme" }),
    );
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("ignores storage events for other keys", () => {
    const parentHtml = document.createElement("html");
    setEmbedded(true, parentHtml);
    initThemeSync();
    parentHtml.setAttribute("data-theme", "dark");
    window.dispatchEvent(new StorageEvent("storage", { key: "other-key" }));
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });

  it("is idempotent — calling twice does not double-register", () => {
    const parentHtml = document.createElement("html");
    parentHtml.setAttribute("data-theme", "dark");
    setEmbedded(true, parentHtml);
    initThemeSync();
    initThemeSync();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    // _teardown in afterEach should clean up without error.
  });

  it("stops reacting to storage events after teardown", () => {
    const parentHtml = document.createElement("html");
    parentHtml.setAttribute("data-theme", "dark");
    setEmbedded(true, parentHtml);
    initThemeSync();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    _teardownThemeSync();
    parentHtml.setAttribute("data-theme", "white");
    window.dispatchEvent(new StorageEvent("storage", { key: "cli-proxy-theme" }));

    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });
});
