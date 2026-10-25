import clsx from "clsx";
import { Download, Globe, Package, Puzzle, Search, ShieldCheck, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { useEngine, useEngineVersion } from "@/engine/context";
import type { Plugin } from "@/engine/engine";
import type { PluginManifest } from "@/plugins/iframePlugin";
import { grantsOf } from "@/plugins/permissions";
import type { PluginManagerPlugin } from "@/plugins/pluginManager";
import { usePlugins } from "@/store/plugins";

type Tab = "installed" | "search" | "install";

/** Extensions view: built-in and external plugins with on/off, plus three ways to install. */
export function PluginManagerPanel() {
  const engine = useEngine();
  useEngineVersion();
  const manager = engine.get<PluginManagerPlugin>("pluginManager");
  const installed = usePlugins((s) => s.installed);
  const [tab, setTab] = useState<Tab>("installed");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const plugins = engine.list().sort((a, b) => (a.profile.order ?? 100) - (b.profile.order ?? 100));
  const builtins = plugins.filter((p) => p.profile.kind !== "external");
  const externals = plugins.filter((p) => p.profile.kind === "external");

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg(label);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="text-xs">
      <div className="flex border-b border-border text-[11px] uppercase tracking-wider">
        {(["installed", "search", "install"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={clsx("flex-1 py-1.5", tab === t ? "text-fg border-b-2 border-accent" : "text-fg-muted hover:text-fg")}>
            {t === "installed" ? `Installed · ${plugins.length}` : t === "search" ? "Search" : "Install"}
          </button>
        ))}
      </div>

      {tab === "installed" && (
        <div className="p-2 space-y-3">
          <div>
            <div className="label">External · {externals.length}</div>
            {externals.length === 0 && <div className="text-fg-muted px-1">None yet. Install one from the Install tab (try the bundled example).</div>}
            {externals.map((p) => (
              <PluginRow key={p.profile.name} plugin={p} manifest={installed.find((m) => m.name === p.profile.name)} onToggle={() => void run(`${p.profile.displayName} ${engine.isActive(p.profile.name) ? "deactivated" : "activated"}`, () => manager.toggle(p.profile.name))} onUninstall={() => confirm(`Uninstall ${p.profile.displayName}?`) && void run("uninstalled", () => manager.uninstall(p.profile.name))} />
            ))}
          </div>
          <div>
            <div className="label">Built in · {builtins.length}</div>
            {builtins.map((p) => (
              <PluginRow key={p.profile.name} plugin={p} onToggle={() => void run(`${p.profile.displayName} ${engine.isActive(p.profile.name) ? "deactivated" : "activated"}`, () => manager.toggle(p.profile.name))} />
            ))}
          </div>
        </div>
      )}

      {tab === "search" && <SearchTab manager={manager} busy={busy} run={run} />}
      {tab === "install" && <InstallForms manager={manager} busy={busy} run={run} />}

      {msg && <div className="px-3 py-2 text-[11px] text-accent border-t border-border">{msg}</div>}
    </div>
  );
}

function PluginRow({ plugin, manifest, onToggle, onUninstall }: { plugin: Plugin; manifest?: PluginManifest; onToggle: () => void; onUninstall?: () => void }) {
  const engine = useEngine();
  const active = engine.isActive(plugin.profile.name);
  const Icon = plugin.profile.icon ?? Puzzle;
  const [open, setOpen] = useState(false);
  const grants = Object.entries(grantsOf(plugin.profile.name));
  return (
    <div className="rounded border border-border bg-bg-elev mb-1.5">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <Icon size={14} className={active ? "text-accent" : "text-fg-muted"} />
        <button className="flex-1 min-w-0 text-left" onClick={() => setOpen((o) => !o)}>
          <div className="flex items-center gap-1.5">
            <span className={clsx("font-semibold truncate", active ? "text-fg" : "text-fg-muted")}>{plugin.profile.displayName}</span>
            {plugin.profile.version && <span className="text-[10px] text-fg-muted">v{plugin.profile.version}</span>}
            {plugin.profile.required && <span className="text-[10px] text-fg-muted">· required</span>}
          </div>
          {plugin.profile.description && <div className="text-[10px] text-fg-muted truncate">{plugin.profile.description}</div>}
        </button>
        {onUninstall && (
          <button onClick={onUninstall} className="text-fg-muted hover:text-error" title="Uninstall">
            <Trash2 size={13} />
          </button>
        )}
        <button onClick={onToggle} disabled={plugin.profile.required} className={clsx(plugin.profile.required ? "text-fg-muted/40" : active ? "text-accent" : "text-fg-muted hover:text-fg")} title={active ? "Deactivate" : "Activate"}>
          {active ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
        </button>
      </div>
      {open && (
        <div className="px-2 pb-2 text-[10px] text-fg-muted space-y-1">
          <div>
            name <span className="font-mono text-fg">{plugin.profile.name}</span> · location {plugin.profile.location ?? "none"}
            {plugin.profile.author && <> · by {plugin.profile.author}</>}
          </div>
          {plugin.profile.methods && plugin.profile.methods.length > 0 && <div>methods: {plugin.profile.methods.join(", ")}</div>}
          {plugin.profile.events && plugin.profile.events.length > 0 && <div>events: {plugin.profile.events.join(", ")}</div>}
          {manifest && (
            <>
              <div className="font-mono break-all">url {manifest.url}</div>
              {manifest.source && (
                <div>
                  source: {manifest.source.kind} <span className="font-mono break-all">{manifest.source.ref}</span>
                </div>
              )}
              <div className="flex items-start gap-1">
                <ShieldCheck size={11} className="shrink-0 mt-0.5" />
                <span>
                  declared: {manifest.permissions && manifest.permissions.length > 0 ? manifest.permissions.join(", ") : "none"}
                  {grants.length > 0 && <> · granted: {grants.map(([k, v]) => `${k}${v ? "" : " (denied)"}`).join(", ")}</>}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface SearchHit {
  name: string;
  version: string;
  description: string;
  author?: string;
  date?: string;
  links?: { npm?: string; homepage?: string };
}

interface RegistryHit {
  name: string;
  displayName: string;
  description?: string;
  version?: string;
  author?: string;
  tags?: string[];
  manifestUrl: string;
  homepage?: string;
}

/** Marketplace-style search: the HardKas plugin registry (curated list) plus npm packages tagged `hardkas-plugin`. */
function SearchTab({ manager, busy, run }: { manager: PluginManagerPlugin; busy: boolean; run: (label: string, fn: () => Promise<unknown>) => Promise<void> }) {
  const engine = useEngine();
  useEngineVersion();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [registry, setRegistry] = useState<RegistryHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const installed = usePlugins((s) => s.installed);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearching(true);
      setErr(null);
      api.plugins
        .search(q)
        .then((r) => {
          setHits(r.results);
          setRegistry(r.registry);
        })
        .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const isInstalled = (pkg: string) => installed.some((m) => m.source?.kind === "npm" && m.source.ref.replace(/(?!^)@.*$/, "") === pkg);
  const total = registry.length + (hits?.length ?? 0);

  return (
    <div className="p-3 space-y-3">
      <div className="relative">
        <Search size={12} className="absolute left-2 top-2 text-fg-muted" />
        <input className="input pl-6" placeholder="Search plugins (registry + npm keyword hardkas-plugin)…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      <div className="text-[10px] text-fg-muted">{searching ? "searching…" : `${total} result${total === 1 ? "" : "s"}${q ? ` for "${q}"` : ""}`}</div>

      {registry.length > 0 && (
        <div>
          <div className="label">HardKas registry</div>
          {registry.map((e) => {
            const done = engine.has(e.name);
            return (
              <div key={e.name} className="rounded border border-border bg-bg-elev p-2 mb-1.5">
                <div className="flex items-center gap-2">
                  <Puzzle size={14} className="text-accent" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-fg truncate">{e.displayName}</span>
                      {e.version && <span className="text-[10px] text-fg-muted">v{e.version}</span>}
                    </div>
                    <div className="text-[10px] text-fg-muted">{e.description}</div>
                  </div>
                  <button className="btn-primary" disabled={busy || done} onClick={() => void run(`installed ${e.displayName}`, () => manager.installFromUrl(new URL(e.manifestUrl, location.origin).toString()))}>
                    {done ? "Installed" : "Install"}
                  </button>
                </div>
                <div className="text-[10px] text-fg-muted mt-1 flex gap-2 flex-wrap">
                  {e.author && <span>by {e.author}</span>}
                  {e.tags?.map((t) => (
                    <span key={t} className="px-1 rounded bg-bg-hover">
                      {t}
                    </span>
                  ))}
                  {e.homepage && (
                    <a href={e.homepage} target="_blank" rel="noreferrer" className="hover:text-accent">
                      homepage ↗
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div>
        <div className="label flex items-center gap-2">
          npm <span className="normal-case tracking-normal text-fg-muted">{hits ? `${hits.length}` : ""}</span>
        </div>
        {err && <div className="text-error">{err}</div>}
        {hits && hits.length === 0 && !searching && (
          <div className="text-fg-muted">
            {registry.length === 0 && q ? `No plugin matches "${q}". ` : ""}
            Nothing on npm tagged <code>hardkas-plugin</code>{q ? ` for "${q}"` : ""} yet: the marketplace is new. To list a plugin here, publish it to npm with <code>"keywords": ["hardkas-plugin"]</code> and a <code>"hardkasPlugin"</code> manifest in its package.json, or add it to <code>registry/plugins.json</code>.
          </div>
        )}
        {hits?.map((h) => (
          <div key={h.name} className="rounded border border-border bg-bg-elev p-2 mb-1.5">
            <div className="flex items-center gap-2">
              <Package size={14} className="text-info" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-fg truncate">{h.name}</span>
                  <span className="text-[10px] text-fg-muted">v{h.version}</span>
                </div>
                <div className="text-[10px] text-fg-muted truncate">{h.description || "no description"}</div>
              </div>
              <button className="btn-primary" disabled={busy || isInstalled(h.name)} onClick={() => void run(`installed ${h.name}`, () => manager.installFromNpm(h.name))}>
                {isInstalled(h.name) ? "Installed" : "Install"}
              </button>
            </div>
            <div className="text-[10px] text-fg-muted mt-1 flex gap-2">
              {h.author && <span>by {h.author}</span>}
              {h.date && <span>{new Date(h.date).toLocaleDateString()}</span>}
              {h.links?.npm && (
                <a href={h.links.npm} target="_blank" rel="noreferrer" className="hover:text-accent">
                  npm ↗
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function InstallForms({ manager, busy, run }: { manager: PluginManagerPlugin; busy: boolean; run: (label: string, fn: () => Promise<unknown>) => Promise<void> }) {
  const [url, setUrl] = useState("");
  const [pkg, setPkg] = useState("");
  const [examples, setExamples] = useState<Array<{ name: string; manifestUrl: string }>>([]);
  const [manual, setManual] = useState({ name: "", displayName: "", url: "", location: "sidePanel", permissions: "" });

  useEffect(() => {
    api.plugins.examples().then(setExamples).catch(() => setExamples([]));
  }, []);

  return (
    <div className="p-3 space-y-4">
      {examples.length > 0 && (
        <div>
          <div className="label">Bundled examples</div>
          {examples.map((e) => (
            <button key={e.name} className="btn-ghost w-full justify-start mb-1" disabled={busy} onClick={() => void run(`installed example ${e.name}`, () => manager.installFromUrl(new URL(e.manifestUrl, location.origin).toString()))}>
              <Puzzle size={12} /> {e.name}
              <span className="ml-auto text-[10px] text-fg-muted">examples/plugins/{e.name}</span>
            </button>
          ))}
        </div>
      )}

      <div>
        <div className="label flex items-center gap-1">
          <Globe size={11} /> From a manifest URL
        </div>
        <div className="flex gap-1">
          <input className="input font-mono" placeholder="https://…/hardkas-plugin.json" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button className="btn-primary shrink-0" disabled={busy || !url} onClick={() => void run("installed", () => manager.installFromUrl(url))}>
            <Download size={12} />
          </button>
        </div>
        <div className="text-[10px] text-fg-muted mt-1">A JSON with name, displayName, url (the plugin page), location, methods, events, permissions.</div>
      </div>

      <div>
        <div className="label flex items-center gap-1">
          <Package size={11} /> From npm
        </div>
        <div className="flex gap-1">
          <input className="input font-mono" placeholder="@scope/hardkas-plugin-foo" value={pkg} onChange={(e) => setPkg(e.target.value)} />
          <button className="btn-primary shrink-0" disabled={busy || !pkg} onClick={() => void run("installed from npm", () => manager.installFromNpm(pkg))}>
            <Download size={12} />
          </button>
        </div>
        <div className="text-[10px] text-fg-muted mt-1">Installed under .hardkas/ide/plugins and served by ide-server. The package declares a "hardkasPlugin" object in package.json.</div>
      </div>

      <div>
        <div className="label">Manual</div>
        <div className="space-y-1">
          <input className="input" placeholder="name (my-plugin)" value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} />
          <input className="input" placeholder="display name" value={manual.displayName} onChange={(e) => setManual({ ...manual, displayName: e.target.value })} />
          <input className="input font-mono" placeholder="https://…/index.html" value={manual.url} onChange={(e) => setManual({ ...manual, url: e.target.value })} />
          <select className="input" value={manual.location} onChange={(e) => setManual({ ...manual, location: e.target.value })}>
            <option value="sidePanel">side panel</option>
            <option value="mainPanel">main panel (tab)</option>
          </select>
          <input className="input font-mono" placeholder="permissions: fileManager.readFile, console.*" value={manual.permissions} onChange={(e) => setManual({ ...manual, permissions: e.target.value })} />
          <button className="btn-primary w-full justify-center" disabled={busy || !manual.name || !manual.url} onClick={() => void run("installed", () => manager.installManifest({ ...manual, location: manual.location as "sidePanel" | "mainPanel", permissions: manual.permissions.split(",").map((s) => s.trim()).filter(Boolean), source: { kind: "manual", ref: manual.url } }))}>
            <Download size={12} /> Install
          </button>
        </div>
      </div>
    </div>
  );
}
