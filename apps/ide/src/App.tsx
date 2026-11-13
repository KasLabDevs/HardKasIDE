import { useEffect, useMemo, useState } from "react";
import { api, type WorkspaceInfo } from "@/api/client";
import { EngineContext } from "@/engine/context";
import { Engine } from "@/engine/engine";
import { HomeScreen } from "@/home/HomeScreen";
import { CompilerPlugin } from "@/plugins/compiler";
import { EditorPlugin } from "@/plugins/editor";
import { EnvironmentPlugin } from "@/plugins/environment";
import { DebugPlugin } from "@/plugins/debug";
import { ExplorerPlugin } from "@/plugins/explorer";
import { FileManagerPlugin } from "@/plugins/fileManager";
import { HistoryPlugin } from "@/plugins/history";
import { IndexPlugin } from "@/plugins/indexView";
import { LineagePlugin } from "@/plugins/lineage";
import { CovenantPlugin } from "@/plugins/covenant";
import { PluginManagerPlugin, REQUIRED_PLUGINS } from "@/plugins/pluginManager";
import { SilverPlugin } from "@/plugins/silver";
import { TestsPlugin } from "@/plugins/tests";
import { VsxPlugin } from "@/plugins/vsx";
import { AccountsPlugin, ArtifactsPlugin, FilesPlugin, RunPlugin, SettingsPlugin } from "@/plugins/sidePlugins";
import { AssistantPlugin } from "@/plugins/assistant";
import { ConsolePlugin } from "@/plugins/console";
import { WithDesktopBar } from "@/shell/DesktopBar";
import { DialogHost } from "@/shell/DialogHost";
import { confirmDialog } from "@/utils/dialog";
import { Workbench } from "@/shell/Workbench";
import { DetachedWorkbench } from "@/shell/DetachedWorkbench";
import { useIde } from "@/store/ide";
import { consumeDetachedFile, parseDetachQuery, subscribeDetachMessages } from "@/utils/detach";

/**
 * Boot: build the engine, register every plugin, then
 * activate them in an explicit order once a workspace is open.
 */
function createEngine(): Engine {
  const engine = new Engine();
  engine.register(new ConsolePlugin());
  engine.register(new FileManagerPlugin());
  engine.register(new EditorPlugin());
  engine.register(new FilesPlugin());
  engine.register(new EnvironmentPlugin());
  engine.register(new ExplorerPlugin());
  engine.register(new AccountsPlugin());
  engine.register(new AssistantPlugin());
  engine.register(new CompilerPlugin());
  engine.register(new SilverPlugin());
  engine.register(new RunPlugin());
  engine.register(new ArtifactsPlugin());
  engine.register(new HistoryPlugin());
  engine.register(new IndexPlugin());
  engine.register(new LineagePlugin());
  engine.register(new CovenantPlugin());
  engine.register(new TestsPlugin());
  engine.register(new DebugPlugin());
  engine.register(new SettingsPlugin());
  engine.register(new PluginManagerPlugin());
  engine.register(new VsxPlugin());
  // Built-in plugins are always on; only external (installed) plugins can be switched off.
  for (const p of engine.list()) {
    p.profile.kind = p.profile.kind ?? "builtin";
    if (p.profile.kind === "builtin" || REQUIRED_PLUGINS.includes(p.profile.name)) p.profile.required = true;
  }
  return engine;
}

const ACTIVATION_ORDER = ["console", "fileManager", "editor", "files", "silverCompiler", "silverContracts", "deployRun", "runHistory", "queryIndex", "environment", "explorer", "accounts", "assistant", "artifacts", "lineage", "covenant", "tests", "debug", "settings", "pluginManager", "vsx"];

export default function App() {
  const engine = useMemo(createEngine, []);
  const detachTarget = useMemo(() => parseDetachQuery(), []);
  const workspace = useIde((s) => s.workspace);
  const setWorkspace = useIde((s) => s.setWorkspace);
  const hasDirtyFiles = useIde((s) => s.openFiles.some((f) => f.kind !== "view" && f.content !== f.savedContent));
  const [booted, setBooted] = useState(false);
  const [serverDown, setServerDown] = useState(false);

  // Warn before closing browser tab if there are unsaved editor changes.
  useEffect(() => {
    if (!hasDirtyFiles) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasDirtyFiles]);

  // On load, ask the server whether a workspace is already open (e.g. --workspace flag).
  useEffect(() => {
    api.workspace
      .get()
      .then((ws) => {
        setWorkspace(ws.root ? ws : null);
        setServerDown(false);
      })
      .catch(() => setServerDown(true))
      .finally(() => setBooted(true));
  }, [setWorkspace]);

  // Activate plugins whenever a workspace becomes available.
  useEffect(() => {
    if (!workspace?.root) return;
    let cancelled = false;
    (async () => {
      await engine.activate(ACTIVATION_ORDER);
      if (cancelled) return;
      if (detachTarget) {
        if (detachTarget.kind === "file") {
          const snapshot = consumeDetachedFile(detachTarget.path);
          if (snapshot && snapshot.content !== snapshot.savedContent) {
            useIde.getState().upsertOpenFile({ path: detachTarget.path, ...snapshot });
          } else {
            await engine.call("fileManager", "open", detachTarget.path).catch((err) => {
              engine.get<ConsolePlugin>("console").error(`Could not open ${detachTarget.path}: ${String(err)}`);
            });
          }
        } else {
          useIde.getState().openView(detachTarget.pluginName, detachTarget.title);
        }
        return;
      }
      const console_ = engine.get<ConsolePlugin>("console");
      console_.info(`Workspace: ${workspace.root}`);
      if (!workspace.hasConfig) console_.warn("No hardkas.config.ts found. Run `init --json` in this console to scaffold one.");
      if (!workspace.hasDevServerToken) console_.info("Tip: run `dev --headless` to start the HardKas dev-server for artifacts and accounts.");
    })();
    return () => {
      cancelled = true;
    };
  }, [detachTarget, engine, workspace]);

  // Listen for re-attached tabs and external saves from detached editor windows.
  useEffect(() => {
    if (detachTarget || !workspace?.root) return;
    return subscribeDetachMessages((msg) => {
      const store = useIde.getState();
      if (msg.type === "reattach-file") {
        if (msg.content !== msg.savedContent) {
          store.upsertOpenFile({
            path: msg.path,
            content: msg.content,
            savedContent: msg.savedContent,
            language: msg.language
          });
        } else {
          void engine.call("fileManager", "open", msg.path);
        }
        window.focus();
      } else if (msg.type === "reattach-view") {
        store.openView(msg.pluginName, msg.title);
        window.focus();
      } else if (msg.type === "file-saved") {
        const existing = store.openFiles.find((f) => f.path === msg.path);
        if (existing && existing.content === existing.savedContent) {
          useIde.setState((s) => ({
            openFiles: s.openFiles.map((f) => (f.path === msg.path ? { ...f, content: msg.content, savedContent: msg.content } : f))
          }));
        }
      }
    });
  }, [detachTarget, engine, workspace]);

  const goHome = async () => {
    const dirty = useIde.getState().openFiles.filter((f) => f.kind !== "view" && f.content !== f.savedContent);
    if (dirty.length > 0 && !(await confirmDialog(`You have ${dirty.length} unsaved file(s). Close workspace and discard changes?`, { title: "Unsaved changes", confirmLabel: "Discard and close", danger: true }))) {
      return;
    }
    await api.workspace.close().catch(() => undefined);
    useIde.setState({ workspace: null, tree: [], openFiles: [], activeFile: null, journal: [], activeSidePlugin: "files" });
    // Deactivate pluginManager first so its listeners don't overwrite savedActive while tearing down.
    if (engine.isActive("pluginManager")) {
      try {
        await engine.deactivate("pluginManager", true);
      } catch {
        // ignore
      }
    }
    // Closing the workspace: every plugin goes down (even required ones) so the next
    // workspace starts from a clean activation and reloads its tree, accounts, artifacts…
    for (const name of [...engine.activeNames()].reverse()) {
      try {
        await engine.deactivate(name, true);
      } catch (e) {
        console.warn(`[ide] deactivate ${name} failed`, e);
      }
    }
  };

  const onOpened = (ws: WorkspaceInfo) => setWorkspace(ws);

  if (!booted) {
    return (
      <WithDesktopBar>
        <div className="h-full grid place-items-center text-fg-muted">Starting HardKas IDE…</div>
      </WithDesktopBar>
    );
  }

  if (serverDown) {
    return (
      <WithDesktopBar>
      <div className="h-full grid place-items-center p-8">
        <div className="max-w-md space-y-3 text-sm">
          <div className="text-lg font-semibold">IDE server not reachable</div>
          <p className="text-fg-muted">The UI talks to the HardKas IDE server on port 7421 and it did not answer. Start it from the repo root:</p>
          <pre className="rounded border border-border bg-bg-panel p-3 text-xs">pnpm dev:server</pre>
          <button type="button" className="btn-primary" onClick={() => location.reload()}>
            Retry
          </button>
        </div>
      </div>
      </WithDesktopBar>
    );
  }

  return (
    <EngineContext.Provider value={engine}>
      {workspace?.root ? (
        detachTarget ? (
          <DetachedWorkbench target={detachTarget} />
        ) : (
          <Workbench onHome={() => void goHome()} />
        )
      ) : (
        <WithDesktopBar>
          <HomeScreen onOpened={onOpened} />
        </WithDesktopBar>
      )}
      <DialogHost />
    </EngineContext.Provider>
  );
}
