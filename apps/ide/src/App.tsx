import { useEffect, useMemo, useState } from "react";
import { api, type WorkspaceInfo } from "@/api/client";
import { EngineContext } from "@/engine/context";
import { Engine } from "@/engine/engine";
import { HomeScreen } from "@/home/HomeScreen";
import { CompilerPlugin } from "@/plugins/compiler";
import { EditorPlugin } from "@/plugins/editor";
import { EnvironmentPlugin } from "@/plugins/environment";
import { FileManagerPlugin } from "@/plugins/fileManager";
import { ArtifactsPlugin, FilesPlugin, RunPlugin, SettingsPlugin } from "@/plugins/sidePlugins";
import { ConsolePlugin } from "@/plugins/console";
import { Workbench } from "@/shell/Workbench";
import { useIde } from "@/store/ide";

/**
 * Boot, in the Remix spirit: build the engine, register every plugin, then
 * activate them in an explicit order once a workspace is open.
 */
function createEngine(): Engine {
  const engine = new Engine();
  engine.register(new ConsolePlugin());
  engine.register(new FileManagerPlugin());
  engine.register(new EditorPlugin());
  engine.register(new FilesPlugin());
  engine.register(new EnvironmentPlugin());
  engine.register(new CompilerPlugin());
  engine.register(new RunPlugin());
  engine.register(new ArtifactsPlugin());
  engine.register(new SettingsPlugin());
  return engine;
}

const ACTIVATION_ORDER = ["console", "fileManager", "editor", "files", "silverCompiler", "deployRun", "environment", "artifacts", "settings"];

export default function App() {
  const engine = useMemo(createEngine, []);
  const workspace = useIde((s) => s.workspace);
  const setWorkspace = useIde((s) => s.setWorkspace);
  const [booted, setBooted] = useState(false);
  const [serverDown, setServerDown] = useState(false);

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
      const console_ = engine.get<ConsolePlugin>("console");
      console_.info(`Workspace: ${workspace.root}`);
      if (!workspace.hasConfig) console_.warn("No hardkas.config.ts found. Run `init --json` in this console to scaffold one.");
      if (!workspace.hasDevServerToken) console_.info("Tip: run `dev --headless` to start the HardKas dev-server for artifacts and accounts.");
    })();
    return () => {
      cancelled = true;
    };
  }, [engine, workspace]);

  const goHome = async () => {
    await api.workspace.close().catch(() => undefined);
    useIde.setState({ workspace: null, tree: [], openFiles: [], activeFile: null, journal: [] });
    for (const name of [...ACTIVATION_ORDER].reverse()) await engine.deactivate(name);
  };

  const onOpened = (ws: WorkspaceInfo) => setWorkspace(ws);

  if (!booted) return <div className="h-full grid place-items-center text-fg-muted">Starting HardKas IDE…</div>;

  if (serverDown) {
    return (
      <div className="h-full grid place-items-center p-8">
        <div className="max-w-md space-y-3 text-sm">
          <div className="text-lg font-semibold">IDE server not reachable</div>
          <p className="text-fg-muted">The UI talks to the HardKas IDE server on port 7421 and it did not answer. Start it from the repo root:</p>
          <pre className="rounded border border-border bg-bg-panel p-3 text-xs">pnpm dev:server</pre>
          <button className="btn-primary" onClick={() => location.reload()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <EngineContext.Provider value={engine}>
      {workspace?.root ? <Workbench onHome={() => void goHome()} /> : <HomeScreen onOpened={onOpened} />}
    </EngineContext.Provider>
  );
}
