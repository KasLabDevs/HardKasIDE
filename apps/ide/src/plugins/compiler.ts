import { Hammer } from "lucide-react";
import { Plugin } from "@/engine/engine";
import { CompilePanel } from "@/panels/CompilePanel";
import { useIde } from "@/store/ide";
import type { EditorDiagnostic } from "./editor";
import type { ConsolePlugin } from "./console";

/**
 * SilverScript compiler plugin. Runs `hardkas silver compile <file> --json` and
 * emits `compilationFinished` so Deploy & Run can
 * list the compiled contracts without knowing about silverc.
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

  constructor() {
    super({
      name: "silverCompiler",
      displayName: "SilverScript compiler",
      description: "Compile .sil contracts with silverc through hardkas",
      location: "sidePanel",
      icon: Hammer,
      order: 20,
      methods: ["compile", "compileCurrent", "getLastResult", "setAutoCompile", "readArgs", "argsFileFor"],
      events: ["compilationFinished", "compilationFailed", "statusChanged"]
    });
  }

  onActivation(): void {
    this.offs.push(
      this.on("editor", "contentChanged", (path) => {
        if (this.autoCompile && typeof path === "string" && path.endsWith(".sil")) {
          void this.call("fileManager", "saveFile", path).then(() => this.compile(path));
        }
      }),
      this.on("fileManager", "fileSaved", (path) => {
        if (typeof path === "string" && path.endsWith(".sil")) this.emit("statusChanged", { key: "edited", title: "Saved, not compiled", type: "info" });
      })
    );
  }

  onDeactivation(): void {
    for (const off of this.offs) off();
    this.offs = [];
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
    if (options?.args !== undefined && options.args.trim() !== "") {
      JSON.parse(options.args); // fail early on invalid JSON
      await this.call("fileManager", "writeFile", argsFile, options.args);
      await this.call("fileManager", "refresh");
      cliArgs.push("--args", argsFile);
    } else if ((await this.readArgs(file)) !== null) {
      cliArgs.push("--args", argsFile);
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

    if (ok) {
      this.emit("statusChanged", { key: "ok", title: `${contracts.length} contract(s)`, type: "success" });
      this.emit("compilationFinished", result);
    } else {
      // silverc only gives us stderr text (no line/column). Mark line 1 so the editor shows something.
      const diagnostics: EditorDiagnostic[] = [{ file, line: 1, severity: "error", message: result.errorText ?? "Compilation failed" }];
      await this.call("editor", "addErrorMarker", diagnostics, "silverc");
      this.emit("statusChanged", { key: "error", title: "Compilation failed", type: "error" });
      this.emit("compilationFailed", result);
    }
    return result;
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
