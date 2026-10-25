import clsx from "clsx";
import { Check, Download, Palette, Search, ShieldAlert, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useEngine } from "@/engine/context";
import type { VsxPlugin } from "@/plugins/vsx";
import { themeId, useVsx, type VsxSearchHit } from "@/store/vsx";

/**
 * "VS Code" tab of the Plugins view: search Open VSX, install, pick a theme,
 * enable/disable and uninstall. Only the declarative parts of an extension run
 * here (themes, grammars, languages, snippets); the rest is listed as not supported.
 */
export function VsxTab() {
  const engine = useEngine();
  const vsx = engine.get<VsxPlugin>("vsx");
  const installed = useVsx((s) => s.installed);
  const activeTheme = useVsx((s) => s.activeTheme);
  const applyUi = useVsx((s) => s.applyUi);
  const busy = useVsx((s) => s.busy);
  const error = useVsx((s) => s.error);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<VsxSearchHit[] | null>(null);
  const [total, setTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);

  useEffect(() => {
    void vsx.refresh();
  }, [vsx]);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearching(true);
      setSearchErr(null);
      vsx
        .search(q || "theme")
        .then((r) => {
          setHits(r.hits);
          setTotal(r.total);
        })
        .catch((e: unknown) => setSearchErr(e instanceof Error ? e.message : String(e)))
        .finally(() => setSearching(false));
    }, 350);
    return () => clearTimeout(t);
  }, [q, vsx]);

  const themes = vsx.themes();
  const isInstalled = (id: string) => installed.some((e) => e.id === id);

  return (
    <div className="p-3 space-y-4">
      <div className="text-[10px] text-fg-muted">
        Extensions come from <a className="text-accent hover:underline" href="https://open-vsx.org" target="_blank" rel="noreferrer">Open VSX</a>, the open registry used by Theia, Gitpod and VSCodium. The IDE applies their <b>themes, grammars, languages and snippets</b>; extension code that needs the VS Code extension host is not run.
      </div>

      {themes.length > 0 && (
        <div>
          <div className="label flex items-center gap-1">
            <Palette size={11} /> Color theme
          </div>
          <select className="input" value={activeTheme ?? ""} onChange={(e) => void vsx.applyTheme(e.target.value || null)}>
            <option value="">HardKas dark (built in)</option>
            {themes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label} · {t.ext.displayName}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 mt-1 cursor-pointer text-[11px]">
            <input type="checkbox" checked={applyUi} onChange={(e) => void vsx.setApplyUi(e.target.checked)} />
            <span>Also recolor the IDE with the theme's workbench colors</span>
          </label>
        </div>
      )}

      {installed.length > 0 && (
        <div>
          <div className="label">Installed · {installed.length}</div>
          {installed.map((e) => {
            const c = e.contributes;
            return (
              <div key={e.id} className={clsx("rounded border border-border bg-bg-elev p-2 mb-1.5", !e.enabled && "opacity-60")}>
                <div className="flex items-center gap-2">
                  {e.icon ? <img src={e.icon} alt="" className="w-6 h-6 rounded" /> : <Palette size={16} className="text-accent" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-fg truncate">{e.displayName}</span>
                      <span className="text-[10px] text-fg-muted">v{e.version}</span>
                    </div>
                    <div className="text-[10px] text-fg-muted truncate">{e.id}</div>
                  </div>
                  <button onClick={() => void vsx.setEnabled(e.id, !e.enabled)} className={e.enabled ? "text-accent" : "text-fg-muted hover:text-fg"} title={e.enabled ? "Disable" : "Enable"}>
                    {e.enabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                  </button>
                  <button onClick={() => confirm(`Uninstall ${e.displayName}?`) && void vsx.uninstall(e.id)} className="text-fg-muted hover:text-error" title="Uninstall">
                    <Trash2 size={13} />
                  </button>
                </div>
                <div className="text-[10px] text-fg-muted mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                  {c.themes.length > 0 && <span>{c.themes.length} theme{c.themes.length === 1 ? "" : "s"}</span>}
                  {c.grammars.length > 0 && <span>{c.grammars.length} grammar{c.grammars.length === 1 ? "" : "s"}</span>}
                  {c.languages.length > 0 && <span>{c.languages.length} language{c.languages.length === 1 ? "" : "s"}</span>}
                  {c.snippets.length > 0 && <span>{c.snippets.length} snippet set{c.snippets.length === 1 ? "" : "s"}</span>}
                  {c.themes.length + c.grammars.length + c.languages.length + c.snippets.length === 0 && <span>nothing the IDE can apply</span>}
                </div>
                {e.unsupported.length > 0 && (
                  <div className="text-[10px] text-warn mt-1 flex items-start gap-1">
                    <ShieldAlert size={11} className="shrink-0 mt-0.5" /> <span>not supported here: {e.unsupported.join(", ")}</span>
                  </div>
                )}
                {c.themes.length > 0 && e.enabled && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {c.themes.map((t) => {
                      const id = themeId(e.id, t.label);
                      const on = activeTheme === id;
                      return (
                        <button key={t.label} onClick={() => void vsx.applyTheme(on ? null : id)} className={clsx("text-[10px] px-1.5 py-0.5 rounded border", on ? "border-accent text-accent" : "border-border text-fg-muted hover:text-fg")}>
                          {on && <Check size={10} className="inline mr-0.5" />}
                          {t.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {error && <div className="text-error text-[11px] whitespace-pre-wrap">{error}</div>}

      <div>
        <div className="relative">
          <Search size={12} className="absolute left-2 top-2 text-fg-muted" />
          <input className="input pl-6" placeholder="Search Open VSX (themes, languages, snippets)…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="text-[10px] text-fg-muted mt-1">{searching ? "searching…" : hits ? `${total.toLocaleString()} extension${total === 1 ? "" : "s"}${q ? ` for "${q}"` : " (showing themes)"}` : ""}</div>
        {searchErr && <div className="text-error text-[11px]">{searchErr}</div>}
        <div className="mt-2 space-y-1.5">
          {hits?.map((h) => (
            <div key={h.id} className="rounded border border-border bg-bg-elev p-2 flex items-center gap-2">
              {h.icon ? <img src={h.icon} alt="" className="w-7 h-7 rounded" loading="lazy" /> : <Palette size={18} className="text-fg-muted" />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-fg truncate">{h.displayName}</span>
                  <span className="text-[10px] text-fg-muted">v{h.version}</span>
                  {h.verified && <Check size={10} className="text-ok" />}
                </div>
                <div className="text-[10px] text-fg-muted truncate" title={h.description}>
                  {h.description || h.id}
                </div>
                <div className="text-[10px] text-fg-muted">
                  {h.namespace} · {h.downloadCount?.toLocaleString() ?? "?"} downloads
                </div>
              </div>
              <button className="btn-primary" disabled={busy !== null || isInstalled(h.id)} onClick={() => void vsx.install(h.namespace, h.name).catch(() => undefined)} title={`Install ${h.id} from Open VSX`}>
                {isInstalled(h.id) ? "Installed" : busy === h.id ? "…" : <Download size={12} />}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
