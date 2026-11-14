import { Hammer } from "lucide-react";
import { api } from "@/api/client";
import { Plugin } from "@/engine/engine";
import { CompilePanel } from "@/panels/CompilePanel";
import { useIde } from "@/store/ide";
import { useSilver } from "@/store/silver";
import { normalizeSilverArgsText } from "@/utils/silverArgs";
import { parseSilverDiagnostics } from "@/utils/silverInspector";
import type { EditorDiagnostic } from "./editor";
import type { ConsolePlugin } from "./console";

/**
 * SilverScript compiler plugin. Runs `hardkas silver compile <file> --json` and
 * emits `compilationFinished` so Deploy & Run can
 * list the compiled contracts without knowing about silverc.
 * Also runs non-polluting inline `silverc` checks on open/save/edit to paint
 * live red/amber squiggles directly in Monaco Editor.
 */

export interface SilverContract {
  name: string;
  entries?: unknown[];
  lockingScript?: string;
  address?: string;
}

export interface CompilationResult {
  file: string;
  ok: boolean;
  contracts: SilverContract[];
  /** Absolute path of the compile record written by the CLI (.hardkas/artifacts/silver/silverCompile-*.json). */
  recordPath?: string;
  raw: unknown;
  errorText?: string;
}

export class CompilerPlugin extends Plugin {
  view = CompilePanel;
  lastResult: CompilationResult | null = null;
  autoCompile = false;
  private offs: Array<() => void> = [];
  private checkTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private checkSeq = new Map<string, number>();

  constructor() {
    super({
      name: "silverCompiler",
      displayName: "SilverScript compiler",
      description: "Compile .sil contracts with silverc through hardkas",
      location: "sidePanel",
      icon: Hammer,
      order: 20,
      methods: ["compile", "compileCurrent", "checkDiagnostics", "getLastResult", "setAutoCompile", "readArgs", "argsFileFor", "audit", "preflight", "doctor", "fuzz"],
      events: ["compilationFinished", "compilationFailed", "statusChanged"]
    });
  }

  onActivation(): void {
    const checkIfSil = (path: string | null | undefined, delayMs = 0) => {
      if (typeof path === "string" && path.endsWith(".sil")) {
        this.scheduleCheck(path, delayMs);
      }
    };

    checkIfSil(useIde.getState().activeFile, 120);

    let lastActive = useIde.getState().activeFile;
    const unsubIde = useIde.subscribe((state) => {
      if (state.activeFile !== lastActive) {
        lastActive = state.activeFile;
        checkIfSil(lastActive, 60);
      }
    });

    this.offs.push(
      unsubIde,
      this.on("editor", "editorMounted", () => {
        checkIfSil(useIde.getState().activeFile, 60);
      }),
      this.on("editor", "contentChanged", (path) => {
        if (typeof path === "string" && path.endsWith(".sil")) {
          if (this.autoCompile) {
            void this.call("fileManager", "saveFile", path).then(() => this.compile(path));
          } else {
            this.scheduleCheck(path, 650);
          }
        }
      }),
      this.on("fileManager", "fileSaved", (path) => {
        if (typeof path === "string" && path.endsWith(".sil")) {
          this.emit("statusChanged", { key: "edited", title: "Saved", type: "info" });
          this.scheduleCheck(path, 50);
        }
      })
    );
  }

  onDeactivation(): void {
    for (const t of this.checkTimers.values()) clearTimeout(t);
    this.checkTimers.clear();
    for (const off of this.offs) off();
    this.offs = [];
  }

  private scheduleCheck(file: string, delayMs: number): void {
    const existing = this.checkTimers.get(file);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.checkTimers.delete(file);
      void this.checkDiagnostics(file);
    }, delayMs);
    this.checkTimers.set(file, timer);
  }

  async checkDiagnostics(file: string): Promise<void> {
    if (!file.endsWith(".sil")) return;
    if (!useIde.getState().workspace?.root) return;

    const seq = (this.checkSeq.get(file) ?? 0) + 1;
    this.checkSeq.set(file, seq);

    let source = useIde.getState().openFiles.find((t) => t.path === file)?.content;
    if (source === undefined) {
      try {
        source = await this.call<string>("fileManager", "readFile", file);
      } catch {
        return;
      }
    }

    try {
      const check = await api.silver.check({ filePath: file, content: source });
      if (this.checkSeq.get(file) !== seq) return; // superseded by newer keystroke

      useSilver.getState().setCheckResult({
        file,
        ok: check.ok,
        errorText: check.ok ? undefined : check.message,
        checkedAt: Date.now()
      });

      const parsedDiags = parseSilverDiagnostics(file, source, {
        file,
        ok: check.ok,
        raw: check.raw,
        errorText: check.ok ? undefined : check.message
      });
      await this.applyMarkers(file, parsedDiags);
    } catch {
      // Fall back to static source diagnostics if server check is unavailable.
      if (this.checkSeq.get(file) !== seq) return;
      const staticDiags = parseSilverDiagnostics(file, source, null);
      await this.applyMarkers(file, staticDiags);
    }
  }

  private async applyMarkers(
    file: string,
    parsedDiags: ReturnType<typeof parseSilverDiagnostics>
  ): Promise<void> {
    const diagnostics: EditorDiagnostic[] = parsedDiags.map((d) => ({
      file: d.file,
      line: d.line,
      column: d.column,
      endLine: d.line,
      endColumn: d.endColumn ?? d.column + 24,
      severity: d.severity,
      message: `[${d.code}] ${d.message}${d.hint ? ` (${d.hint})` : ""}`
    }));
    await this.call("editor", "setFileMarkers", file, diagnostics, "silverc");
  }

  setAutoCompile(value: boolean): void {
    this.autoCompile = value;
  }

  getLastResult(): CompilationResult | null {
    return this.lastResult;
  }

  async compileCurrent(options?: { args?: string }): Promise<CompilationResult | null> {
    const current = useIde.getState().activeFile;
    if (!current) return null;
    await this.call("fileManager", "saveFile", current);
    return this.compile(current, options);
  }

  /** Constructor args live next to the source as `<name>.constructor-args.json` (HardKas fixture convention). */
  argsFileFor(file: string): string {
    return file.replace(/\.sil$/, "") + ".constructor-args.json";
  }

  async readArgs(file: string): Promise<string | null> {
    try {
      return await this.call<string>("fileManager", "readFile", this.argsFileFor(file));
    } catch {
      return null;
    }
  }

  async compile(file: string, options?: { args?: string }): Promise<CompilationResult> {
    const terminal = this.engine.get<ConsolePlugin>("console");
    this.emit("statusChanged", { key: "compiling", title: "Compiling…", type: "info" });
    await this.call("editor", "clearErrorMarkers", "silverc");

    const cliArgs = ["silver", "compile", file];
    const argsFile = this.argsFileFor(file);
    let usedArgsText: string | null = null;
    if (options?.args !== undefined && options.args.trim() !== "") {
      JSON.parse(options.args); // fail early on invalid JSON
      // Hex bytes and "pubkey" are written in the CLI's own form (bytes as a list of numbers).
      const normalized = normalizeSilverArgsText(options.args);
      await this.call("fileManager", "writeFile", argsFile, normalized);
      await this.call("fileManager", "refresh");
      usedArgsText = normalized;
      cliArgs.push("--args", argsFile);
    } else {
      const existingArgs = await this.readArgs(file);
      if (existingArgs !== null) {
        usedArgsText = existingArgs;
        cliArgs.push("--args", argsFile);
      }
    }
    cliArgs.push("--json");

    const run = await terminal.runHardkas(cliArgs);
    const raw = run.result as Record<string, unknown> | null;
    const ok = run.status === "succeeded" && (raw === null || raw.ok !== false);

    const contracts = extractContracts(raw);
    const result: CompilationResult = {
      file,
      ok,
      contracts,
      recordPath: typeof raw?.recordPath === "string" ? raw.recordPath : undefined,
      raw,
      errorText: ok ? undefined : messageOf(raw, run)
    };
    this.lastResult = result;
    useSilver.getState().setCheckResult({
      file,
      ok,
      errorText: ok ? undefined : result.errorText,
      checkedAt: Date.now()
    });

    if (ok && usedArgsText && typeof raw?.contentHash === "string" && raw.contentHash) {
      await this.call("fileManager", "writeFile", `.hardkas/ide/covenant-args/${raw.contentHash}.json`, usedArgsText).catch(() => undefined);
    }

    // Read source code to extract line-accurate diagnostics & pragma checks
    let source = useIde.getState().openFiles.find((t) => t.path === file)?.content ?? "";
    if (!source) {
      try {
        source = await this.call<string>("fileManager", "readFile", file);
      } catch {
        source = "";
      }
    }

    const parsedDiags = parseSilverDiagnostics(file, source, {
      file,
      ok,
      contracts: contracts.map((c) => ({ name: c.name, lockingScript: c.lockingScript, address: c.address })),
      raw,
      errorText: result.errorText
    });

    await this.applyMarkers(file, parsedDiags);

    if (ok) {
      this.emit("statusChanged", { key: "ok", title: `${contracts.length} contract(s)`, type: "success" });
      this.emit("compilationFinished", result);
    } else {
      if (parsedDiags.length === 0) {
        await this.applyMarkers(file, [
          { file, line: 1, column: 1, severity: "error", code: "SILVERC-ERR", message: result.errorText ?? "Compilation failed" }
        ]);
      }
      this.emit("statusChanged", { key: "error", title: "Compilation failed", type: "error" });
      this.emit("compilationFailed", result);
    }
    return result;
  }

  async audit(file: string): Promise<{ ok: boolean; result: unknown; error?: string }> {
    const terminal = this.engine.get<ConsolePlugin>("console");
    const run = await terminal.runHardkas(["silver", "audit", file, "--json"]);
    return { ok: run.status === "succeeded", result: run.result, error: run.exitCode ? `exit code ${run.exitCode}` : undefined };
  }

  async preflight(file: string): Promise<{ ok: boolean; result: unknown; error?: string }> {
    const terminal = this.engine.get<ConsolePlugin>("console");
    const run = await terminal.runHardkas(["silver", "preflight", file, "--json"]);
    return { ok: run.status === "succeeded", result: run.result, error: run.exitCode ? `exit code ${run.exitCode}` : undefined };
  }

  async doctor(): Promise<{ ok: boolean; result: unknown }> {
    const terminal = this.engine.get<ConsolePlugin>("console");
    const run = await terminal.runHardkas(["silver", "doctor", "--json"]);
    return { ok: run.status === "succeeded", result: run.result };
  }

  async fuzz(file: string): Promise<{ ok: boolean; result: unknown; error?: string }> {
    const terminal = this.engine.get<ConsolePlugin>("console");
    const run = await terminal.runHardkas(["silver", "fuzz", file, "--json"]);
    return { ok: run.status === "succeeded", result: run.result, error: run.exitCode ? `exit code ${run.exitCode}` : undefined };
  }
}

function extractContracts(raw: unknown): SilverContract[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  const candidates = [obj.contracts, (obj.result as Record<string, unknown> | undefined)?.contracts, (obj.record as Record<string, unknown> | undefined)?.contracts];
  for (const c of candidates) {
    if (Array.isArray(c)) return c as SilverContract[];
  }
  return [];
}

function messageOf(raw: Record<string, unknown> | null, run: { exitCode: number | null }): string {
  if (raw && typeof raw.message === "string") return raw.message;
  if (raw && typeof raw.code === "string") return raw.code;
  return `silverc exited with code ${run.exitCode}`;
}
