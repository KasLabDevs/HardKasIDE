import clsx from "clsx";
import { Box, ChevronDown, ChevronRight, CircleDot, FunctionSquare, ListTree, Lock, Rocket, ShieldCheck, X } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { useEngine } from "@/engine/context";
import type { EditorPlugin } from "@/plugins/editor";
import { formatKas } from "@/store/env";
import { useSilver } from "@/store/silver";
import { useIde } from "@/store/ide";
import { parseSilOutline } from "@/utils/silParser";

/**
 * Eclipse-style Outline for the active SilverScript file: contract → constructor
 * parameters (its "attributes") and entries (its "functions"). Click to jump.
 * When the file is compiled, each entry shows its dispatch tag and the contract its P2SH address;
 * deployed instances of that contract are listed too.
 */
export function Outline() {
  const engine = useEngine();
  const file = useIde((s) => s.openFiles.find((f) => f.path === s.activeFile));
  const setOutlineOpen = useIde((s) => s.setOutlineOpen);
  const compiled = useSilver((s) => s.compiled);
  const deployments = useSilver((s) => s.deployments);
  const isSil = file?.path.endsWith(".sil") ?? false;
  const deferredContent = useDeferredValue(file?.content);
  const outline = useMemo(() => (isSil && deferredContent !== undefined ? parseSilOutline(deferredContent) : null), [isSil, deferredContent]);
  const compiledForFile = compiled && file && compiled.sourcePath === file.path ? compiled : null;

  const goto = (line: number) => engine.get<EditorPlugin>("editor").gotoLine(line);

  return (
    <aside className="h-full bg-bg-panel border-l border-border flex flex-col text-xs min-w-0">
      <header className="panel-title flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <ListTree size={13} /> Outline
        </span>
        <button type="button" onClick={() => setOutlineOpen(false)} className="p-0.5 rounded text-fg-muted hover:text-fg hover:bg-bg-hover normal-case cursor-pointer" title="Hide outline" aria-label="Hide outline">
          <X size={13} />
        </button>
      </header>
      <div className="flex-1 min-h-0 overflow-auto py-1">
        {!file && <div className="px-3 py-2 text-fg-muted">Open a file to see its outline.</div>}
        {file && !isSil && <div className="px-3 py-2 text-fg-muted">Outline is available for SilverScript (.sil) files.</div>}
        {outline && (
          <>
            {outline.pragma && (
              <div className="px-3 py-1 text-fg-muted">
                pragma silverscript <span className="text-fg font-mono">{outline.pragma}</span>
              </div>
            )}
            {outline.contracts.length === 0 && <div className="px-3 py-2 text-fg-muted">No contract found yet.</div>}
            {outline.contracts.map((c) => {
              const abi = compiledForFile?.contracts.find((x) => x.name === c.name);
              const instances = deployments.filter((d) => d.contract === c.name);
              return (
                <Section
                  key={c.name}
                  icon={<Box size={13} className="text-accent shrink-0" />}
                  title={c.name}
                  hint={`${c.params.length} param · ${c.entries.length} entr${c.entries.length === 1 ? "y" : "ies"}`}
                  onClick={() => goto(c.line)}
                >
                  {abi?.address && (
                    <Row icon={<ShieldCheck size={11} className="text-ok shrink-0" />} label="compiled" value={abi.address} mono title="P2SH address" />
                  )}
                  <Group title="Constructor">
                    {c.params.map((p) => (
                      <Row key={p.name} icon={<CircleDot size={11} className="text-info shrink-0" />} label={p.name} value={p.type} onClick={() => goto(c.line)} />
                    ))}
                    {c.params.length === 0 && <div className="pl-7 text-fg-muted">no parameters</div>}
                  </Group>
                  <Group title="Entries">
                    {c.entries.map((e) => {
                      const tag = abi?.entries.find((x) => x.name === e.name)?.dispatchTag;
                      return (
                        <Row
                          key={e.name}
                          icon={<FunctionSquare size={11} className="text-warn shrink-0" />}
                          label={`${e.name}(${e.params.map((p) => `${p.type} ${p.name}`).join(", ")})`}
                          value={`${e.requires} require${e.requires === 1 ? "" : "s"}${tag ? ` · #${tag}` : ""}`}
                          onClick={() => goto(e.line)}
                          title={`lines ${e.line}–${e.endLine}`}
                        />
                      );
                    })}
                  </Group>
                  {instances.length > 0 && (
                    <Group title="Deployed">
                      {instances.map((d) => (
                        <Row
                          key={d.contentHash}
                          icon={d.spent ? <Rocket size={11} className="text-fg-muted shrink-0" /> : <Lock size={11} className="text-accent shrink-0" />}
                          label={d.spent ? "spent" : formatKas(d.valueSompi)}
                          value={d.txId.slice(0, 14) + "…"}
                          mono
                          onClick={() => void engine.call("fileManager", "open", d.recordPath)}
                          title={d.recordPath}
                        />
                      ))}
                    </Group>
                  )}
                </Section>
              );
            })}
          </>
        )}
      </div>
    </aside>
  );
}

function Section({ icon, title, hint, onClick, children }: { icon: React.ReactNode; title: string; hint?: string; onClick: () => void; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        className="flex items-center gap-1 px-2 py-1 hover:bg-bg-hover cursor-pointer outline-none"
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          className="text-fg-muted hover:text-fg p-0.5 rounded cursor-pointer"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        {icon}
        <span className="font-semibold text-fg truncate">{title}</span>
        {hint && <span className="ml-auto text-[10px] text-fg-muted whitespace-nowrap tabular-nums">{hint}</span>}
      </div>
      {open && <div className="pb-1">{children}</div>}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-0.5">
      <div className="pl-7 text-[10px] uppercase tracking-wider text-fg-muted select-none">{title}</div>
      {children}
    </div>
  );
}

function Row({ icon, label, value, mono, onClick, title }: { icon: React.ReactNode; label: string; value?: string; mono?: boolean; onClick?: () => void; title?: string }) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={clsx("flex items-center gap-1.5 pl-7 pr-2 py-0.5 min-w-0 outline-none", onClick && "cursor-pointer hover:bg-bg-hover")}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      title={title ?? value}
    >
      {icon}
      <span className="text-fg truncate tabular-nums">{label}</span>
      {value && <span className={clsx("ml-auto text-[10px] text-fg-muted truncate max-w-[55%] tabular-nums", mono && "font-mono")}>{value}</span>}
    </div>
  );
}
