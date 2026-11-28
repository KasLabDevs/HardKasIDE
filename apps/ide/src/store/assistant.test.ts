import { beforeEach, describe, expect, it } from "vitest";
import { useAssistant } from "./assistant";

beforeEach(() => {
  useAssistant.setState({ mode: "agent", turns: [], busy: false });
});

describe("useAssistant unified multi-turn store", () => {
  it("appends sequential Ask and Agent turns into one continuous conversation without erasing prior runs", () => {
    const a1 = useAssistant.getState().startTurnPair("agent", "Write Escrow.sil", "contracts/Escrow.sil");
    useAssistant.getState().addThought(a1, "Checking contracts folder first");
    useAssistant.getState().upsertStep(a1, { id: "s1", title: "Writing Escrow.sil", tool: "write_file", status: "running" });
    useAssistant.getState().upsertStep(a1, { id: "s1", title: "Wrote contracts/Escrow.sil", tool: "write_file", status: "succeeded", input: { path: "contracts/Escrow.sil" } });
    useAssistant.getState().finishTurn(a1, { content: "Created Escrow.sil.", ok: true });

    const a2 = useAssistant.getState().startTurnPair("chat", "Explain the timeout entry");
    useAssistant.getState().append(a2, "The timeout entry ");
    useAssistant.getState().append(a2, "checks locktime.");
    useAssistant.getState().finishTurn(a2, { ok: true });

    const { turns, busy } = useAssistant.getState();
    expect(busy).toBe(false);
    expect(turns).toHaveLength(4);
    expect(turns[0]).toMatchObject({ role: "user", mode: "agent", content: "Write Escrow.sil", attachedFile: "contracts/Escrow.sil" });
    expect(turns[1]).toMatchObject({ role: "assistant", mode: "agent", content: "Created Escrow.sil.", ok: true });
    expect(turns[1].steps?.[0].status).toBe("succeeded");
    expect(turns[2]).toMatchObject({ role: "user", mode: "chat", content: "Explain the timeout entry" });
    expect(turns[3]).toMatchObject({ role: "assistant", mode: "chat", content: "The timeout entry checks locktime.", ok: true });
  });

  it("clears pendingConfirm on finishTurn and wipes all turns cleanly on clear()", () => {
    const a1 = useAssistant.getState().startTurnPair("agent", "Check version");
    useAssistant.getState().setConfirm(a1, { id: "c1", command: "hardkas --version" });
    expect(useAssistant.getState().turns[1].pendingConfirm).toEqual({ id: "c1", command: "hardkas --version" });

    useAssistant.getState().finishTurn(a1, { error: "Stopped by user.", ok: false });
    expect(useAssistant.getState().turns[1].pendingConfirm).toBeNull();
    expect(useAssistant.getState().turns[1].ok).toBe(false);

    useAssistant.getState().clear();
    expect(useAssistant.getState().turns).toEqual([]);
    expect(useAssistant.getState().busy).toBe(false);
  });
});
