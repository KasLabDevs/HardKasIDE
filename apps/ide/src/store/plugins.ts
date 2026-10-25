import { create } from "zustand";
import type { PluginManifest } from "@/plugins/iframePlugin";

/**
 * Installed external plugins and the set of active plugins, persisted in
 * localStorage (Remix keeps the same two lists: its plugin directory and `activate=`).
 */

const INSTALLED_KEY = "hardkas-ide.plugins.installed";
const ACTIVE_KEY = "hardkas-ide.plugins.active";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

interface PluginsState {
  installed: PluginManifest[];
  /** null = never saved: activate everything built in. */
  savedActive: string[] | null;
  install(m: PluginManifest): void;
  uninstall(name: string): void;
  setSavedActive(names: string[]): void;
}

export const usePlugins = create<PluginsState>((set) => ({
  installed: read<PluginManifest[]>(INSTALLED_KEY, []),
  savedActive: read<string[] | null>(ACTIVE_KEY, null),
  install: (m) =>
    set((s) => {
      const installed = [...s.installed.filter((x) => x.name !== m.name), m];
      write(INSTALLED_KEY, installed);
      return { installed };
    }),
  uninstall: (name) =>
    set((s) => {
      const installed = s.installed.filter((x) => x.name !== name);
      write(INSTALLED_KEY, installed);
      return { installed };
    }),
  setSavedActive: (names) => {
    write(ACTIVE_KEY, names);
    set({ savedActive: names });
  }
}));

/** Validates a manifest coming from a URL, npm or the form. */
export function validateManifest(input: unknown): PluginManifest {
  if (!input || typeof input !== "object") throw new Error("Manifest must be a JSON object");
  const m = input as Record<string, unknown>;
  const name = String(m.name ?? "").trim();
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(name)) throw new Error("name: lowercase letters, digits and dashes, e.g. my-plugin");
  const url = String(m.url ?? "").trim();
  if (!url) throw new Error("url is required");
  if (!/^https?:\/\//.test(url) && !url.startsWith("/")) throw new Error("url must be http(s) or a path served by ide-server");
  const location = m.location === "mainPanel" ? "mainPanel" : "sidePanel";
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
  return {
    name,
    displayName: String(m.displayName ?? name),
    description: m.description ? String(m.description) : undefined,
    version: m.version ? String(m.version) : undefined,
    author: m.author ? String(m.author) : undefined,
    url,
    location,
    methods: list(m.methods),
    events: list(m.events),
    permissions: list(m.permissions),
    source: (m.source as PluginManifest["source"]) ?? { kind: "manual", ref: url }
  };
}
