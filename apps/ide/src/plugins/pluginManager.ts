import { Puzzle } from "lucide-react";
import { api } from "@/api/client";
import { Plugin } from "@/engine/engine";
import { PluginManagerPanel } from "@/panels/PluginManagerPanel";
import { usePlugins, validateManifest } from "@/store/plugins";
import { IframePlugin, type PluginManifest } from "./iframePlugin";
import { clearGrants } from "./permissions";

/** The set of built-ins the IDE cannot run without. */
export const REQUIRED_PLUGINS = ["console", "fileManager", "editor", "files", "pluginManager", "vsx"];

/**
 * Plugin manager (Remix's plugin manager + VS Code's extensions view, scaled down):
 * lists every plugin, activates / deactivates them, installs external ones from a
 * manifest URL, a form, or an npm package, and persists the choices.
 */
export class PluginManagerPlugin extends Plugin {
  view = PluginManagerPanel;
  private offs: Array<() => void> = [];

  constructor() {
    super({
      name: "pluginManager",
      displayName: "Plugins",
      description: "Activate, deactivate and install plugins",
      location: "sidePanel",
      icon: Puzzle,
      order: 85,
      required: true,
      methods: ["installFromUrl", "installManifest", "installFromNpm", "uninstall", "toggle"],
      events: ["installed", "uninstalled"]
    });
  }

  onActivation(): void {
    // Register installed external plugins; activate the ones the user left active.
    const { installed, savedActive } = usePlugins.getState();
    for (const m of installed) {
      if (!this.engine.has(m.name)) this.engine.register(new IframePlugin(m));
    }
    void (async () => {
      for (const m of installed) {
        if (!savedActive || savedActive.includes(m.name)) {
          try {
            await this.engine.activate(m.name);
          } catch {
            // broken plugin: leave inactive
          }
        }
      }
      this.offs.push(
        this.engine.on("engine", "pluginActivated", () => this.persistActive()),
        this.engine.on("engine", "pluginDeactivated", () => this.persistActive())
      );
    })();
  }

  onDeactivation(): void {
    for (const off of this.offs) off();
    this.offs = [];
  }

  private persistActive(): void {
    if (!this.engine.isActive(this.profile.name)) return;
    usePlugins.getState().setSavedActive(this.engine.activeNames());
  }

  async toggle(name: string): Promise<void> {
    if (this.engine.isActive(name)) await this.engine.deactivate(name);
    else await this.engine.activate(name);
  }

  /** Fetches a manifest JSON (through ide-server, so CORS does not get in the way). */
  async installFromUrl(url: string): Promise<PluginManifest> {
    const text = await api.plugins.fetch(url);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("The URL did not return JSON. For a page URL, use the manual form and give the page as url.");
    }
    const m = validateManifest(json);
    // Relative plugin page next to the manifest.
    if (!/^https?:\/\//.test(m.url) && !m.url.startsWith("/")) m.url = new URL(m.url, url).toString();
    m.source = { kind: "url", ref: url };
    return this.installManifest(m);
  }

  async installManifest(input: PluginManifest): Promise<PluginManifest> {
    const m = validateManifest(input);
    if (this.engine.has(m.name) && this.engine.get(m.name).profile.kind !== "external") throw new Error(`"${m.name}" is a built-in plugin name`);
    if (this.engine.has(m.name)) await this.engine.unregister(m.name);
    usePlugins.getState().install(m);
    this.engine.register(new IframePlugin(m));
    await this.engine.activate(m.name);
    this.emit("installed", m);
    return m;
  }

  /** `npm install <pkg>` into .hardkas/ide/plugins via ide-server, then read its "hardkasPlugin" manifest. */
  async installFromNpm(pkg: string): Promise<PluginManifest> {
    const res = await api.plugins.npm(pkg);
    const m = validateManifest({ ...res.manifest, source: { kind: "npm", ref: pkg } });
    return this.installManifest(m);
  }

  async uninstall(name: string): Promise<void> {
    if (this.engine.has(name)) await this.engine.unregister(name);
    usePlugins.getState().uninstall(name);
    clearGrants(name);
    this.emit("uninstalled", name);
  }
}
