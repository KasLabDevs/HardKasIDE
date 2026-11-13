import { beforeEach, describe, expect, it } from "vitest";
import { parseDetachQuery } from "@/utils/detach";
import { useIde, type OpenFile } from "./ide";

function mkFile(path: string, dirty = false): OpenFile {
  return {
    path,
    content: dirty ? "edited" : "saved",
    savedContent: "saved",
    language: "typescript"
  };
}

describe("useIde tab closing helpers", () => {
  beforeEach(() => {
    useIde.setState({
      openFiles: [mkFile("a.ts"), mkFile("b.ts"), mkFile("c.ts"), mkFile("d.ts")],
      activeFile: "b.ts"
    });
  });

  it("closeFile selects the right neighbor, or previous when closing the rightmost tab", () => {
    useIde.getState().closeFile("b.ts");
    expect(useIde.getState().openFiles.map((f) => f.path)).toEqual(["a.ts", "c.ts", "d.ts"]);
    expect(useIde.getState().activeFile).toBe("c.ts");

    useIde.getState().setActiveFile("d.ts");
    useIde.getState().closeFile("d.ts");
    expect(useIde.getState().openFiles.map((f) => f.path)).toEqual(["a.ts", "c.ts"]);
    expect(useIde.getState().activeFile).toBe("c.ts");
  });

  it("closeFiles supports Close Others while activating preferred target if needed", () => {
    useIde.getState().closeFiles(["a.ts", "b.ts", "d.ts"], "c.ts");
    expect(useIde.getState().openFiles.map((f) => f.path)).toEqual(["c.ts"]);
    expect(useIde.getState().activeFile).toBe("c.ts");
  });

  it("closeFiles preserves activeFile if it was not closed (e.g. Close Tabs to the Left / Right)", () => {
    useIde.getState().setActiveFile("d.ts");
    useIde.getState().closeFiles(["a.ts", "b.ts"], "c.ts");
    expect(useIde.getState().openFiles.map((f) => f.path)).toEqual(["c.ts", "d.ts"]);
    expect(useIde.getState().activeFile).toBe("d.ts");
  });

  it("closeFiles handles Close All cleanly", () => {
    useIde.getState().closeFiles(["a.ts", "b.ts", "c.ts", "d.ts"]);
    expect(useIde.getState().openFiles).toEqual([]);
    expect(useIde.getState().activeFile).toBeNull();
  });
});

describe("parseDetachQuery", () => {
  it("parses detached file and view targets", () => {
    expect(parseDetachQuery("?detachFile=src%2FApp.tsx")).toEqual({ kind: "file", path: "src/App.tsx" });
    expect(parseDetachQuery("?detachView=cluster&detachTitle=Cluster%20pods")).toEqual({
      kind: "view",
      pluginName: "cluster",
      title: "Cluster pods"
    });
    expect(parseDetachQuery("?detachView=lineage")).toEqual({
      kind: "view",
      pluginName: "lineage",
      title: "lineage"
    });
    expect(parseDetachQuery("")).toBeNull();
    expect(parseDetachQuery("?foo=bar")).toBeNull();
  });
});

describe("useIde secondary dock panel visibility", () => {
  beforeEach(() => {
    useIde.getState().resetLayout();
  });

  it("toggles right-docked panels such as Assistant open/hidden and restores on reveal or resetLayout", () => {
    expect(useIde.getState().docks.assistant).toBe("right");
    expect(useIde.getState().hiddenPanels.assistant).toBeUndefined();

    useIde.getState().togglePanelHidden("assistant");
    expect(useIde.getState().hiddenPanels.assistant).toBe(true);

    useIde.getState().togglePanelHidden("assistant");
    expect(useIde.getState().hiddenPanels.assistant).toBeUndefined();

    useIde.getState().setPanelHidden("assistant", true);
    expect(useIde.getState().hiddenPanels.assistant).toBe(true);

    useIde.getState().revealPlugin("assistant", "Assistant");
    expect(useIde.getState().hiddenPanels.assistant).toBeUndefined();

    useIde.getState().setPanelHidden("assistant", true);
    useIde.getState().resetLayout();
    expect(useIde.getState().hiddenPanels).toEqual({});
  });
});
