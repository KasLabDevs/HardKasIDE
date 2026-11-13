import { beforeEach, describe, expect, it } from "vitest";
import { useIde } from "./ide";
import { useSearch } from "./search";

describe("useSearch bottom Search tab lifecycle", () => {
  beforeEach(() => {
    useIde.setState({ terminalOpen: false });
    useSearch.setState({ bottomSearchOpen: false, revealBottomSeq: 0 });
  });

  it("keeps the bottom Search tab hidden until revealed and lets the user close it", () => {
    expect(useSearch.getState().bottomSearchOpen).toBe(false);

    useSearch.getState().revealBottomSearch();
    expect(useSearch.getState().bottomSearchOpen).toBe(true);
    expect(useSearch.getState().revealBottomSeq).toBe(1);
    expect(useIde.getState().terminalOpen).toBe(true);

    useSearch.getState().closeBottomSearch();
    expect(useSearch.getState().bottomSearchOpen).toBe(false);
    // Closing the Search tab leaves the bottom panel open for Console / Terminal.
    expect(useIde.getState().terminalOpen).toBe(true);
  });
});
