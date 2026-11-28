import type * as Monaco from "monaco-editor";
import { api } from "@/api/client";
import type { EditorPlugin } from "@/plugins/editor";
import { normalizeDiagPath, useDiagnostics, type IdeDiagnostic } from "@/store/diagnostics";
import { useIde } from "@/store/ide";
import { indexWorkspaceContracts, lintHardkasWorkspaceFile } from "@/utils/hardkasLint";
import { lintSilverSource } from "@/utils/silverLinter";
import { projectTsOptions } from "./projectTsOptions";

const AMBIENT_UI_AND_ASSETS = `
declare module "*.css" { const styles: Record<string, string>; export default styles; }
declare module "*.scss" { const styles: Record<string, string>; export default styles; }
declare module "*.sass" { const styles: Record<string, string>; export default styles; }
declare module "*.less" { const styles: Record<string, string>; export default styles; }
declare module "*.svg" { const src: string; export default src; }
declare module "*.png" { const src: string; export default src; }
declare module "*.jpg" { const src: string; export default src; }
declare module "*.jpeg" { const src: string; export default src; }
declare module "*.webp" { const src: string; export default src; }
declare module "*.json" { const val: any; export default val; }
`;

const FALLBACK_JSX_AMBIENT = `
declare namespace JSX {
  interface Element {}
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}
`;

let defaultsConfigured = false;
let syncSeq = 0;
let baseCompilerOptions: Monaco.languages.typescript.CompilerOptions | null = null;
let appliedProjectOptionsKey = "";

function flattenMessageText(msg: string | { messageText: string; next?: unknown[] } | undefined): string {
  if (!msg) return "";
  if (typeof msg === "string") return msg;
  const parts: string[] = [msg.messageText];
  let cur: unknown = msg.next;
  while (Array.isArray(cur) && cur.length > 0) {
    const first = cur[0] as { messageText?: string; next?: unknown[] } | string;
    if (typeof first === "string") {
      parts.push(first);
      break;
    }
    if (first?.messageText) parts.push(first.messageText);
    cur = first?.next;
  }
  return parts.join(" ");
}

function offsetToLineCol(text: string, offset: number): { line: number; column: number } {
  const safe = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let lastNl = -1;
  for (let i = 0; i < safe; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lastNl = i;
    }
  }
  return { line, column: safe - lastNl };
}

/** Configures Monaco's TypeScript, JavaScript, and CSS language workers for full React/JSX/Vite/HardKas support. */
export function configureMonacoLanguageDefaults(monaco: typeof Monaco): void {
  if (defaultsConfigured) return;
  defaultsConfigured = true;

  const tsDefaults = monaco.languages.typescript.typescriptDefaults;
  const jsDefaults = monaco.languages.typescript.javascriptDefaults;

  // TypeScript 5.4.5 inside Monaco ts.worker.js supports ModuleResolutionKind.Bundler = 100
  // (required to resolve package.json "exports" like @hardkas/testing/scenarios and react/jsx-runtime).
  const compilerOptions: Monaco.languages.typescript.CompilerOptions = {
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: 100 as Monaco.languages.typescript.ModuleResolutionKind,
    jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
    allowJs: true,
    checkJs: false,
    allowNonTsExtensions: true,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    resolveJsonModule: true,
    isolatedModules: true,
    allowImportingTsExtensions: true,
    noEmit: true,
    skipLibCheck: true,
    strictNullChecks: true,
    noImplicitAny: false
  };

  const diagOptions: Monaco.languages.typescript.DiagnosticsOptions = {
    noSemanticValidation: false,
    noSyntaxValidation: false,
    noSuggestionDiagnostics: false
  };

  baseCompilerOptions = compilerOptions;
  tsDefaults.setCompilerOptions(compilerOptions);
  jsDefaults.setCompilerOptions({ ...compilerOptions, checkJs: false });
  tsDefaults.setDiagnosticsOptions(diagOptions);
  jsDefaults.setDiagnosticsOptions(diagOptions);
  tsDefaults.setEagerModelSync(true);
  jsDefaults.setEagerModelSync(true);

  const cssDefaults = monaco.languages.css?.cssDefaults;
  if (cssDefaults?.options) {
    cssDefaults.setOptions({
      ...cssDefaults.options,
      validate: true
    });
  }
}

/**
 * Fetches workspace source files + `.d.ts` type definitions from ide-server, feeds them to Monaco's
 * TypeScript/JS workers, and scans the workspace for live SilverScript, HardKas, and TS diagnostics.
 */
export async function syncWorkspaceIntelligence(
  monaco: typeof Monaco,
  editorPlugin: EditorPlugin
): Promise<void> {
  const root = useIde.getState().workspace?.root;
  if (!root) {
    useDiagnostics.getState().resetWorkspace();
    return;
  }

  const seq = ++syncSeq;
  let ctx: {
    sourceFiles: Array<{ path: string; content: string }>;
    typeDefs: Array<{ path: string; content: string }>;
    truncated: boolean;
  };
  try {
    ctx = await api.fs.intellisense();
  } catch {
    return;
  }
  if (seq !== syncSeq) return;

  // Overlay unsaved open tabs on top of disk contents so cross-file checks reflect live edits
  const fileMap = new Map<string, string>();
  for (const f of ctx.sourceFiles) {
    fileMap.set(normalizeDiagPath(f.path), f.content);
  }
  for (const tab of useIde.getState().openFiles) {
    if (tab.kind !== "view") {
      fileMap.set(normalizeDiagPath(tab.path), tab.content);
    }
  }

  const extraLibs: Array<{ content: string; filePath: string }> = [
    { content: AMBIENT_UI_AND_ASSETS, filePath: "file:///__hardkas_assets__.d.ts" }
  ];
  const registeredPaths = new Set<string>();
  const addLib = (filePath: string, content: string) => {
    if (registeredPaths.has(filePath)) return;
    registeredPaths.add(filePath);
    extraLibs.push({ filePath, content });
  };

  let hasReactTypes = false;
  for (const td of ctx.typeDefs) {
    const norm = normalizeDiagPath(td.path);
    if (norm.includes("@types/react")) hasReactTypes = true;
    addLib(`file:///${norm}`, td.content);
    // Also alias dapp/node_modules/* under /node_modules/* if not already present so imports resolve smoothly
    if (norm.startsWith("dapp/node_modules/")) {
      addLib(`file:///${norm.slice("dapp/".length)}`, td.content);
    }
  }
  if (!hasReactTypes) {
    addLib("file:///__hardkas_jsx_fallback__.d.ts", FALLBACK_JSX_AMBIENT);
  }

  const existingModels = new Set(monaco.editor.getModels().map((m) => m.uri.toString()));
  for (const [relPath, content] of fileMap.entries()) {
    if (/\.(?:[cm]?[jt]sx?|json)$/i.test(relPath)) {
      const uri = `file:///${relPath}`;
      if (!existingModels.has(uri)) addLib(uri, content);
    }
  }

  // Check with the project's own tsconfig strictness, so the editor and the project's tsc agree.
  if (baseCompilerOptions) {
    const tsconfig = fileMap.get("tsconfig.json");
    const project = projectTsOptions(tsconfig).options as Monaco.languages.typescript.CompilerOptions;
    const key = JSON.stringify(project);
    if (key !== appliedProjectOptionsKey) {
      appliedProjectOptionsKey = key;
      monaco.languages.typescript.typescriptDefaults.setCompilerOptions({ ...baseCompilerOptions, ...project });
      monaco.languages.typescript.javascriptDefaults.setCompilerOptions({ ...baseCompilerOptions, ...project, checkJs: false });
    }
  }

  monaco.languages.typescript.typescriptDefaults.setExtraLibs(extraLibs);
  monaco.languages.typescript.javascriptDefaults.setExtraLibs(extraLibs);

  const allFiles = Array.from(fileMap.entries()).map(([p, content]) => ({ path: p, content }));
  const openPaths = new Set(
    useIde
      .getState()
      .openFiles.filter((f) => f.kind !== "view")
      .map((f) => normalizeDiagPath(f.path))
  );

  // 1. Workspace SilverScript linting (closed .sil files; active/open .sil files also use CompilerPlugin)
  const silWorkspaceMap = new Map<string, IdeDiagnostic[]>();
  for (const f of allFiles) {
    if (!f.path.toLowerCase().endsWith(".sil")) continue;
    // Skip files already managed by CompilerPlugin in raw diagnostics so we don't duplicate silverc + sil-lint
    const existing = useDiagnostics.getState().raw[f.path];
    if (existing?.silverc && openPaths.has(f.path)) continue;
    const items = lintSilverSource(f.path, f.content);
    if (items.length > 0) silWorkspaceMap.set(f.path, items);
  }
  useDiagnostics.getState().replaceSourceDiagnostics("workspace-sil", silWorkspaceMap);

  // 2. Cross-file HardKas / Constructor Args / Covenant checks across ALL workspace files
  const contractIndex = indexWorkspaceContracts(allFiles);
  const hardkasMap = new Map<string, IdeDiagnostic[]>();
  editorPlugin.clearErrorMarkers("hardkas");
  for (const f of allFiles) {
    const items = lintHardkasWorkspaceFile(f.path, f.content, contractIndex);
    if (items.length > 0) {
      hardkasMap.set(f.path, items);
      editorPlugin.setFileMarkers(
        f.path,
        items.map((d) => ({
          file: d.file,
          line: d.line,
          column: d.column,
          endLine: d.endLine,
          endColumn: d.endColumn,
          severity: d.severity,
          message: `[${d.code}] ${d.message}`
        })),
        "hardkas"
      );
    }
  }
  useDiagnostics.getState().replaceSourceDiagnostics("hardkas", hardkasMap);

  // 3. Background TypeScript diagnostics for closed workspace .ts/.tsx files via Monaco tsWorker
  try {
    const getWorker = await monaco.languages.typescript.getTypeScriptWorker();
    if (seq !== syncSeq) return;
    const closedTsFiles = allFiles
      .filter((f) => /\.(?:tsx?|mts|cts)$/i.test(f.path) && !f.path.endsWith(".d.ts") && !openPaths.has(f.path))
      .slice(0, 45);

    const tsWorkspaceMap = new Map<string, IdeDiagnostic[]>();
    if (closedTsFiles.length > 0) {
      const firstUri = monaco.Uri.parse(closedTsFiles[0].path);
      const worker = await getWorker(firstUri);
      for (const f of closedTsFiles) {
        if (seq !== syncSeq) return;
        const uriStr = monaco.Uri.parse(f.path).toString();
        const [syn, sem] = await Promise.all([
          worker.getSyntacticDiagnostics(uriStr).catch(() => []),
          worker.getSemanticDiagnostics(uriStr).catch(() => [])
        ]);
        const items: IdeDiagnostic[] = [];
        for (const d of [...syn, ...sem]) {
          if (typeof d.start !== "number") continue;
          const startPos = offsetToLineCol(f.content, d.start);
          const endPos = offsetToLineCol(f.content, d.start + Math.max(1, d.length ?? 1));
          const sev = d.category === 1 ? "error" : d.category === 0 ? "warning" : "info";
          items.push({
            id: `ws-ts:${f.path}:${d.code}:${startPos.line}:${startPos.column}`,
            file: f.path,
            source: "typescript",
            line: startPos.line,
            column: startPos.column,
            endLine: endPos.line,
            endColumn: endPos.column,
            severity: sev,
            code: `TS${d.code}`,
            message: flattenMessageText(d.messageText)
          });
        }
        if (items.length > 0) tsWorkspaceMap.set(f.path, items);
      }
    }
    if (seq === syncSeq) {
      useDiagnostics.getState().replaceSourceDiagnostics("workspace-ts", tsWorkspaceMap);
    }
  } catch {
    // Worker not ready yet (editor will validate open files once mounted)
  }
}

/** Syncs Monaco markers from any active text model into `useDiagnostics`, keeping open files current. */
export function syncModelMarkersToStore(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel
): void {
  const filePath = normalizeDiagPath(model.uri.path);
  if (!filePath || filePath.startsWith("__hardkas_")) return;

  const markers = monaco.editor.getModelMarkers({ resource: model.uri });
  // Only mirror native Monaco language workers here (silverc/sil-lint/hardkas already push directly)
  const workerItems: IdeDiagnostic[] = [];
  for (let i = 0; i < markers.length; i++) {
    const m = markers[i];
    const owner = (m.owner ?? "").toLowerCase();
    if (owner === "silverc" || owner === "sil-lint" || owner === "hardkas") continue;

    const severity: IdeDiagnostic["severity"] =
      m.severity === monaco.MarkerSeverity.Error
        ? "error"
        : m.severity === monaco.MarkerSeverity.Warning
          ? "warning"
          : "info";

    const codeStr = typeof m.code === "object" && m.code ? String(m.code.value) : m.code ? String(m.code) : undefined;
    workerItems.push({
      id: `monaco:${filePath}:${m.owner ?? "lang"}:${m.startLineNumber}:${m.startColumn}:${i}`,
      file: filePath,
      source: m.owner || model.getLanguageId() || "editor",
      line: m.startLineNumber,
      column: m.startColumn,
      endLine: m.endLineNumber,
      endColumn: m.endColumn,
      severity,
      code: codeStr,
      message: m.message
    });
  }

  const store = useDiagnostics.getState();
  store.setFileDiagnostics(filePath, "monaco", workerItems);
  // Open model supersedes background workspace-ts / workspace-sil snapshots for this path
  if (store.raw[filePath]?.["workspace-ts"]) {
    store.setFileDiagnostics(filePath, "workspace-ts", []);
  }
  if (filePath.endsWith(".sil") && store.raw[filePath]?.["workspace-sil"]) {
    store.setFileDiagnostics(filePath, "workspace-sil", []);
  }
}
