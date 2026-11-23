import { SquarePlay } from "lucide-react";
import { api, IdeApiError } from "@/api/client";
import { Plugin } from "@/engine/engine";
import { ScriptsPanel } from "@/panels/ScriptsPanel";
import { useScripts } from "@/store/scripts";

const LOCKFILE_RE = /(?:^|\/)(?:package\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|npm-shrinkwrap\.json|bun\.lockb?)$/;

/**
 * Discovers workspace & subproject package.json scripts and launches them in integrated terminals.
 */
export class ScriptsPlugin extends Plugin {
  view = ScriptsPanel;
  private offs: Array<() => void> = [];

  constructor() {
    super({
      name: "scripts",
      displayName: "Scripts",
      description: "Run package.json scripts from the workspace and subpackages",
      location: "sidePanel",
      icon: SquarePlay,
      order: 35,
      methods: ["refresh", "stopAll"],
      events: ["updated"]
    });
  }

  onActivation(): void {
    void this.refresh();
    const onManifestChange = (path: unknown) => {
      if (typeof path === "string" && LOCKFILE_RE.test(path)) void this.refresh();
    };
    this.offs.push(
      this.on("fileManager", "fileSaved", onManifestChange),
      this.on("fileManager", "fileAdded", onManifestChange),
      this.on("fileManager", "fileRemoved", onManifestChange),
      this.on("fileManager", "treeChanged", () => void this.refresh())
    );
  }

  onDeactivation(): void {
    for (const off of this.offs) off();
    this.offs = [];
    useScripts.getState().resetWorkspace();
  }

  async refresh(): Promise<void> {
    const store = useScripts.getState();
    store.setLoading(true);
    try {
      const res = await api.scripts();
      store.setPackages(res.packages);
      store.setError(null);
      this.emit("updated", res.packages);
    } catch (e) {
      if (e instanceof IdeApiError && e.code === "NO_WORKSPACE") {
        store.setPackages([]);
        store.setError(null);
      } else {
        store.setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      store.setLoading(false);
    }
  }

  async stopAll(): Promise<void> {
    await useScripts.getState().stopAllScripts();
  }
}
