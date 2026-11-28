import { describe, expect, it } from "vitest";
import { formatDiagnostics, redact } from "./diagnostics";

describe("diagnostics report", () => {
  it("masks the home folder and 64-hex strings", () => {
    expect(redact("C:\\Users\\jrodr\\Documents\\app")).toBe("~\\Documents\\app");
    expect(redact("/Users/ana/dev and /home/bob/x")).toBe("~/dev and ~/x");
    expect(redact(`key ${"ab".repeat(32)} end`)).toBe("key <hex64> end");
  });

  it("lists versions, Docker, the node and the last console lines", () => {
    const text = formatDiagnostics({
      ideVersion: "0.4.0",
      userAgent: "test",
      server: { version: "0.4.0", port: 7421 },
      system: { node: "v24.22.1", platform: "win32", docker: { installed: true, running: false, serverVersion: null, error: null } },
      cli: { version: "0.13.0", pinned: "0.13.0", source: "project", error: null },
      workspace: { name: "escrow", trusted: true },
      target: "localnet",
      node: { status: "stopped", running: false, rpcReady: false },
      journal: [
        { kind: "command", text: "hardkas localnet start --toccata --json", at: "2026-11-28T10:00:01.000Z" },
        { kind: "error", text: "Could not start the node: error during connect\nmore", at: "2026-11-28T10:00:02.000Z" },
        { kind: "json", text: "{}", at: "2026-11-28T10:00:03.000Z" }
      ],
      errors: []
    });
    expect(text).toContain("- IDE: 0.4.0\n");
    expect(text).toContain("Docker: installed, not running");
    expect(text).toContain("HardKas CLI: 0.13.0 (tested with 0.13.0, from project)");
    expect(text).toContain("Project: escrow · trusted: yes");
    expect(text).toContain("Local node: stopped · running: no · RPC ready: no");
    expect(text).toContain("10:00:02 error   Could not start the node: error during connect");
    expect(text).not.toContain("more");
    expect(text).not.toContain("10:00:03");
  });

  it("says what could not be read instead of failing", () => {
    const text = formatDiagnostics({ ideVersion: "0.4.0", userAgent: "t", target: "simulator", journal: [], errors: ["system (offline)"] });
    expect(text).toContain("Project: none open");
    expect(text).toContain("Could not read: system (offline)");
    expect(text).not.toContain("### Console");
  });
});
