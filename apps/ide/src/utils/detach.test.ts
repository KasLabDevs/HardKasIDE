import { afterEach, describe, expect, it, vi } from "vitest";
import { getTabId } from "@/api/client";
import { openDetachedWindow } from "@/utils/detach";

const originalWindow = globalThis.window;

function installBrowserStub(search: string, href = `http://127.0.0.1:7421/${search}`) {
  const bag = new Map<string, string>();
  const openSpy = vi.fn(() => ({} as Window));
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { search, href } as Location,
      sessionStorage: {
        getItem: (k: string) => bag.get(k) ?? null,
        setItem: (k: string, v: string) => {
          bag.set(k, v);
        },
        removeItem: (k: string) => {
          bag.delete(k);
        },
        clear: () => bag.clear(),
        key: (index: number) => [...bag.keys()][index] ?? null,
        get length() {
          return bag.size;
        }
      } as Storage,
      open: openSpy
    } as unknown as Window
  });
  return { bag, openSpy };
}

afterEach(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
});

describe("tab isolation & detached window tab inheritance", () => {
  it("adopts detachTab query parameter into sessionStorage for detached browser/Tauri windows", () => {
    const { bag } = installBrowserStub("?detachFile=contracts%2FEscrow.sil&detachTab=parent-tab-99");
    const tabId = getTabId();
    expect(tabId).toBe("parent-tab-99");
    expect(bag.get("hardkas.tabId")).toBe("parent-tab-99");
  });

  it("allocates a fresh independent tabId when no detachTab is present", () => {
    installBrowserStub("");
    const idA = getTabId();
    installBrowserStub("");
    const idB = getTabId();

    expect(idA).toBeTruthy();
    expect(idB).toBeTruthy();
    expect(idA).not.toBe(idB);
  });

  it("propagates the parent tabId in detachTab URL when opening a detached window", () => {
    const { openSpy } = installBrowserStub("");
    const parentId = getTabId();
    const opened = openDetachedWindow({
      path: "view:assistant",
      content: "",
      savedContent: "",
      language: "view",
      kind: "view",
      title: "Assistant"
    });

    expect(opened).toBe(true);
    expect(openSpy).toHaveBeenCalledTimes(1);
    const launchedUrl = new URL((openSpy.mock.calls as unknown[][])[0][0] as string);
    expect(launchedUrl.searchParams.get("detachView")).toBe("assistant");
    expect(launchedUrl.searchParams.get("detachTab")).toBe(parentId);
  });
});
