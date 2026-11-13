import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Engine } from "@/engine/engine";
import { LineagePlugin } from "./lineage";
import { useLineage } from "@/store/lineage";

const mocks = vi.hoisted(() => ({
  devStatus: vi.fn(),
  dev: vi.fn(),
  storeLineage: vi.fn()
}));

vi.mock("@/api/client", () => {
  class IdeApiError extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number
    ) {
      super(message);
    }
  }
  return {
    IdeApiError,
    api: {
      devStatus: mocks.devStatus,
      dev: mocks.dev,
      store: {
        lineage: mocks.storeLineage
      }
    }
  };
});

describe("LineagePlugin offline fallback", () => {
  let plugin: LineagePlugin;

  beforeEach(() => {
    useLineage.setState({
      artifacts: [],
      edges: [],
      fresh: new Set(),
      replays: {},
      live: false,
      loading: false,
      error: null,
      selected: null
    });
    mocks.devStatus.mockReset();
    mocks.dev.mockReset();
    mocks.storeLineage.mockReset();
    plugin = new LineagePlugin();
    const engine = new Engine();
    engine.register(plugin);
  });

  afterEach(() => {
    plugin.onDeactivation();
    vi.unstubAllGlobals();
  });

  it("loads store/disk fallback cleanly when dev-server (:7420) is unavailable", async () => {
    mocks.devStatus.mockResolvedValue({ available: false, url: "http://127.0.0.1:7420", error: null });
    mocks.storeLineage.mockResolvedValue({
      artifacts: [{ artifactId: "a1", schema: "hardkas.txPlan", createdAt: "2026-11-13T03:00:00.000Z" }],
      edges: [{ id: "a1->a2", source: "a1", target: "a2" }],
      source: "store"
    });

    await plugin.refresh();

    const state = useLineage.getState();
    expect(mocks.dev).not.toHaveBeenCalled();
    expect(mocks.storeLineage).toHaveBeenCalledTimes(1);
    expect(state.live).toBe(false);
    expect(state.error).toBeNull();
    expect(state.artifacts).toHaveLength(1);
    expect(state.edges).toEqual([{ id: "a1->a2", source: "a1", target: "a2" }]);
  });

  it("falls back to store/disk if /api/dev throws after status reported available", async () => {
    class MockEventSource {
      addEventListener() {}
      close() {}
      onerror: (() => void) | null = null;
    }
    vi.stubGlobal("EventSource", MockEventSource);
    mocks.devStatus.mockResolvedValue({ available: true, url: "http://127.0.0.1:7420", error: null });
    mocks.dev.mockRejectedValue(new Error("dev-server crashed"));
    mocks.storeLineage.mockResolvedValue({
      artifacts: [{ artifactId: "b1", schema: "hardkas.txReceipt.v1" }],
      edges: [],
      source: "disk"
    });

    await plugin.refresh();

    const state = useLineage.getState();
    expect(mocks.dev).toHaveBeenCalled();
    expect(mocks.storeLineage).toHaveBeenCalledTimes(1);
    expect(state.live).toBe(false);
    expect(state.error).toBeNull();
    expect(state.artifacts[0].artifactId).toBe("b1");
  });
});
