import type { ComponentType } from "react";

/**
 * A small plugin engine in the spirit of Remix's @remixproject/engine.
 *
 * Every feature (files, editor, compiler, run, terminal) is a Plugin with a
 * profile. Plugins talk to each other only through the engine:
 *
 *   await this.call("fileManager", "readFile", path)
 *   this.on("compiler", "compilationFinished", handler)
 *   this.emit("compilationFinished", payload)
 *
 * UI plugins declare a location and a React component; the shell mounts every
 * side-panel view once and hides inactive ones, so state survives switching.
 */

export type PluginLocation = "sidePanel" | "mainPanel" | "none";

export interface PluginProfile {
  name: string;
  displayName: string;
  description?: string;
  location?: PluginLocation;
  /** lucide icon component for the icon rail */
  icon?: ComponentType<{ size?: number; className?: string }>;
  methods?: string[];
  events?: string[];
  /** Order in the icon rail; lower first. */
  order?: number;
  /** Built into the IDE, or installed by the user (iframe). */
  kind?: "builtin" | "external";
  /** Cannot be deactivated (the IDE would not work without it). */
  required?: boolean;
  version?: string;
  author?: string;
  /** For external plugins: "plugin.method" calls they are allowed to make without asking. */
  permissions?: string[];
}

type Listener = (...args: unknown[]) => void;

export abstract class Plugin {
  engine!: Engine;
  constructor(public readonly profile: PluginProfile) {}

  /** React view for sidePanel/mainPanel plugins. */
  view?: ComponentType;

  onActivation?(): void | Promise<void>;
  onDeactivation?(): void | Promise<void>;

  call<T = unknown>(plugin: string, method: string, ...args: unknown[]): Promise<T> {
    return this.engine.call<T>(plugin, method, ...args);
  }
  on(plugin: string, event: string, listener: Listener): () => void {
    return this.engine.on(plugin, event, listener);
  }
  emit(event: string, ...args: unknown[]): void {
    this.engine.emit(this.profile.name, event, ...args);
  }
}

export class Engine {
  private plugins = new Map<string, Plugin>();
  private active = new Set<string>();
  private listeners = new Map<string, Set<Listener>>();
  private changeListeners = new Set<() => void>();
  /** Bumped on every registration/activation change; used by React to re-render. */
  version = 0;

  register(plugin: Plugin): void {
    if (this.plugins.has(plugin.profile.name)) {
      throw new Error(`Plugin already registered: ${plugin.profile.name}`);
    }
    plugin.engine = this;
    this.plugins.set(plugin.profile.name, plugin);
    this.notify();
  }

  async activate(names: string | string[]): Promise<void> {
    for (const name of Array.isArray(names) ? names : [names]) {
      const plugin = this.plugins.get(name);
      if (!plugin) throw new Error(`Unknown plugin: ${name}`);
      if (this.active.has(name)) continue;
      this.active.add(name);
      await plugin.onActivation?.();
      this.emit("engine", "pluginActivated", name);
    }
    this.notify();
  }

  async deactivate(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin || !this.active.has(name)) return;
    if (plugin.profile.required) throw new Error(`${name} is required and cannot be deactivated`);
    this.active.delete(name);
    await plugin.onDeactivation?.();
    this.emit("engine", "pluginDeactivated", name);
    this.notify();
  }

  /** Removes a plugin entirely (external plugins on uninstall). */
  async unregister(name: string): Promise<void> {
    await this.deactivate(name);
    this.plugins.delete(name);
    for (const key of [...this.listeners.keys()]) if (key.startsWith(`${name}:`)) this.listeners.delete(key);
    this.notify();
  }

  has(name: string): boolean {
    return this.plugins.has(name);
  }

  /** Names of the active plugins (persisted by the plugin manager). */
  activeNames(): string[] {
    return [...this.active];
  }

  get<T extends Plugin = Plugin>(name: string): T {
    const plugin = this.plugins.get(name);
    if (!plugin) throw new Error(`Unknown plugin: ${name}`);
    return plugin as T;
  }

  isActive(name: string): boolean {
    return this.active.has(name);
  }

  list(): Plugin[] {
    return [...this.plugins.values()];
  }

  listByLocation(location: PluginLocation): Plugin[] {
    return this.list()
      .filter((p) => p.profile.location === location && this.active.has(p.profile.name))
      .sort((a, b) => (a.profile.order ?? 100) - (b.profile.order ?? 100));
  }

  async call<T = unknown>(name: string, method: string, ...args: unknown[]): Promise<T> {
    const plugin = this.plugins.get(name);
    if (!plugin) throw new Error(`Unknown plugin: ${name}`);
    if (!this.active.has(name)) throw new Error(`Plugin not active: ${name}`);
    if (plugin.profile.methods && !plugin.profile.methods.includes(method)) {
      throw new Error(`${name} does not expose method "${method}"`);
    }
    const fn = (plugin as unknown as Record<string, unknown>)[method];
    if (typeof fn !== "function") {
      // External (iframe) plugins expose methods over postMessage.
      const invoke = (plugin as unknown as { invoke?: (m: string, ...a: unknown[]) => Promise<unknown> }).invoke;
      if (plugin.profile.kind === "external" && typeof invoke === "function") return invoke.call(plugin, method, ...args) as Promise<T>;
      throw new Error(`${name}.${method} is not a function`);
    }
    return (fn as (...a: unknown[]) => T | Promise<T>).apply(plugin, args);
  }

  on(name: string, event: string, listener: Listener): () => void {
    const key = `${name}:${event}`;
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(listener);
    return () => set!.delete(listener);
  }

  emit(name: string, event: string, ...args: unknown[]): void {
    const set = this.listeners.get(`${name}:${event}`);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        listener(...args);
      } catch (error) {
        console.error(`[engine] listener for ${name}:${event} failed`, error);
      }
    }
  }

  /** Subscribe to registration/activation changes (used by the shell to re-render). */
  subscribe(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private notify(): void {
    this.version += 1;
    for (const l of this.changeListeners) l();
  }
}
