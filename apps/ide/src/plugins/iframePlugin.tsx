import { Puzzle } from "lucide-react";
import { useEffect, useRef } from "react";
import { Plugin, type PluginLocation } from "@/engine/engine";
import { useEngine } from "@/engine/context";
import { askPermission, isAllowed } from "./permissions";

/**
 * External plugins run in a sandboxed iframe and talk to the engine over
 * postMessage, with the same call / on / emit vocabulary as built-in plugins.
 *
 *   iframe → host   { type:"hardkas:call", id, plugin, method, args }
 *                   { type:"hardkas:on",   plugin, event }
 *                   { type:"hardkas:emit", event, args }
 *   host → iframe   { type:"hardkas:ready", name, profile }
 *                   { type:"hardkas:response", id, ok, result | error }
 *                   { type:"hardkas:event", plugin, event, args }
 *
 * Every call to another plugin goes through the permission handler.
 */

export interface PluginManifest {
  name: string;
  displayName: string;
  description?: string;
  version?: string;
  author?: string;
  /** Page to load in the iframe. Absolute http(s) URL or a path served by ide-server. */
  url: string;
  location?: PluginLocation;
  /** Methods the plugin exposes to others (invoked through postMessage). */
  methods?: string[];
  events?: string[];
  /** "plugin.method" calls allowed without asking. */
  permissions?: string[];
  /** Where it was installed from (shown in the manager). */
  source?: { kind: "url" | "manual" | "npm" | "example"; ref: string };
}

export class IframePlugin extends Plugin {
  readonly manifest: PluginManifest;
  private frame: HTMLIFrameElement | null = null;
  private subscriptions: Array<() => void> = [];
  private subscribedKeys = new Set<string>();
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private seq = 0;
  private origin: string;
  private listener = (event: MessageEvent) => this.onMessage(event);

  constructor(manifest: PluginManifest) {
    super({
      name: manifest.name,
      displayName: manifest.displayName,
      description: manifest.description,
      location: manifest.location ?? "sidePanel",
      icon: Puzzle,
      order: 70,
      kind: "external",
      version: manifest.version,
      author: manifest.author,
      methods: manifest.methods,
      events: manifest.events,
      permissions: manifest.permissions
    });
    this.manifest = manifest;
    this.origin = resolveOrigin(manifest.url);
    this.view = () => <IframeView plugin={this} />;
  }

  /**
   * Plugin pages served by ide-server (/api/plugins/...) are loaded straight from ide-server
   * (http://127.0.0.1:7421), not through the Vite origin. That makes them a different origin from the
   * IDE, so the browser's same-origin policy isolates them from the IDE's storage, cookies and DOM,
   * which lets the sandbox keep `allow-same-origin` (needed for scripts to run and postMessage to work
   * in every engine) without giving the plugin access to the host page.
   */
  resolvedUrl(): string {
    return pluginPageUrl(this.manifest.url);
  }

  /** True when the page is on a different origin than the IDE (so allow-same-origin cannot reach the host). */
  isCrossOrigin(): boolean {
    try {
      return new URL(this.resolvedUrl()).origin !== location.origin;
    } catch {
      return false;
    }
  }

  onActivation(): void {
    window.addEventListener("message", this.listener);
  }

  onDeactivation(): void {
    window.removeEventListener("message", this.listener);
    for (const off of this.subscriptions) off();
    this.subscriptions = [];
    this.subscribedKeys.clear();
    for (const p of this.pending.values()) p.reject(new Error("plugin deactivated"));
    this.pending.clear();
  }

  attach(frame: HTMLIFrameElement | null): void {
    this.frame = frame;
  }

  /** Invoked by the engine when another plugin calls one of this plugin's methods. */
  invoke(method: string, ...args: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = `h${++this.seq}`;
      this.pending.set(id, { resolve, reject });
      this.post({ type: "hardkas:invoke", id, method, args });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${this.profile.name}.${method} timed out`));
      }, 15000);
    });
  }

  private post(message: unknown): void {
    // Sandboxed iframes without allow-same-origin have an opaque ("null") origin;
    // we post directly to this.frame.contentWindow reference.
    this.frame?.contentWindow?.postMessage(message, "*");
  }

  private async onMessage(event: MessageEvent): Promise<void> {
    if (!this.frame || event.source !== this.frame.contentWindow) return;
    if (this.origin !== "null" && event.origin !== "null" && event.origin !== this.origin) return;
    const msg = event.data as { type?: string; id?: string; plugin?: string; method?: string; args?: unknown[]; event?: string; ok?: boolean; result?: unknown; error?: string };
    if (!msg || typeof msg.type !== "string") return;
    switch (msg.type) {
      case "hardkas:hello":
        this.post({ type: "hardkas:ready", name: this.profile.name, profile: { ...this.profile, icon: undefined, view: undefined } });
        break;
      case "hardkas:call": {
        const { id, plugin, method, args } = msg;
        if (!id || !plugin || !method) return;
        try {
          if (isBlockedExternalCall(plugin, method, args ?? [])) {
            throw new Error(`blocked sensitive call: ${plugin}.${method}`);
          }
          const allowed = isAllowed(this.profile.name, plugin, method, this.manifest.permissions) ?? askPermission(this.profile.name, this.profile.displayName, plugin, method);
          if (!allowed) throw new Error(`permission denied: ${plugin}.${method}`);
          const result = await this.call(plugin, method, ...(args ?? []));
          this.post({ type: "hardkas:response", id, ok: true, result: safe(result) });
        } catch (e) {
          this.post({ type: "hardkas:response", id, ok: false, error: e instanceof Error ? e.message : String(e) });
        }
        break;
      }
      case "hardkas:on": {
        if (!msg.plugin || !msg.event) return;
        const plugin = msg.plugin;
        const name = msg.event;
        const subKey = `${plugin}:${name}`;
        if (this.subscribedKeys.has(subKey)) return;
        this.subscribedKeys.add(subKey);
        this.subscriptions.push(this.on(plugin, name, (...args) => this.post({ type: "hardkas:event", plugin, event: name, args: safe(args) })));
        break;
      }
      case "hardkas:emit":
        if (msg.event) this.emit(msg.event, ...(msg.args ?? []));
        break;
      case "hardkas:response": {
        // reply to an invoke() from the host
        const p = msg.id ? this.pending.get(msg.id) : undefined;
        if (!p || !msg.id) return;
        this.pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new Error(msg.error ?? "plugin error"));
        break;
      }
      default:
        break;
    }
  }
}

/** Prevents external plugins from reading private keys, dev-server tokens, or installing other plugins. */
function isBlockedExternalCall(plugin: string, method: string, args: unknown[]): boolean {
  if (plugin === "environment" && (method === "copyPrivateKey" || method === "getPrivateKey")) return true;
  if (plugin === "accounts") return true;
  if (plugin === "pluginManager") return true;
  if (plugin === "fileManager") {
    for (const arg of args) {
      if (typeof arg === "string") {
        const norm = arg.replace(/\\/g, "/").toLowerCase();
        if (norm.includes("accounts.real.json") || norm.includes("dev-server-token")) return true;
      }
    }
  }
  return false;
}

/** Strips functions and class instances so the value survives postMessage. */
function safe(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return null;
  }
}

/** Base URL of ide-server as seen by the browser (a different origin from the Vite dev server). */
const IDE_SERVER_ORIGIN: string = (import.meta.env.VITE_IDE_SERVER as string | undefined) ?? "http://127.0.0.1:7421";

/** Absolute http(s) URLs stay as they are; ide-server paths (/api/plugins/...) go to ide-server itself. */
export function pluginPageUrl(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  if (url.startsWith("/api/plugins/")) return IDE_SERVER_ORIGIN + url;
  return new URL(url, location.origin).toString();
}

function resolveOrigin(url: string): string {
  try {
    return new URL(pluginPageUrl(url)).origin;
  } catch {
    return "null";
  }
}

function IframeView({ plugin }: { plugin: IframePlugin }) {
  const ref = useRef<HTMLIFrameElement>(null);
  useEngine();
  useEffect(() => {
    plugin.attach(ref.current);
    return () => plugin.attach(null);
  }, [plugin]);
  return (
    <iframe
      ref={ref}
      src={plugin.resolvedUrl()}
      title={plugin.profile.displayName}
      className="w-full h-full border-0 bg-bg"
      // Cross-origin pages keep allow-same-origin (so they can run and use their own storage) but the
      // origin boundary protects the IDE. A same-origin page would defeat that, so it gets no such flag.
      sandbox={plugin.isCrossOrigin() ? "allow-scripts allow-same-origin allow-forms allow-popups allow-modals" : "allow-scripts allow-forms allow-popups allow-modals"}
      referrerPolicy="no-referrer"
    />
  );
}
