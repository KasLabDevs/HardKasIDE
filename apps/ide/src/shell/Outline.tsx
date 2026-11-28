import clsx from "clsx";
import { Box, ChevronDown, ChevronRight, CircleDot, FunctionSquare, ListTree, Lock, Rocket, ShieldCheck, X } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { useEngine } from "@/engine/context";
import type { EditorPlugin } from "@/plugins/editor";
import { SymbolIcon } from "@/shell/Breadcrumbs";
import { useEditorCursor } from "@/store/editorCursor";
import { formatKas } from "@/store/env";
import { useSilver } from "@/store/silver";
import { useIde } from "@/store/ide";
import { parseSilOutline } from "@/utils/silParser";
import { activeSymbolTrail, extractDocumentSymbols, type DocumentSymbol } from "@/utils/symbols";

const SUPPORTED_EXT_RE = /\.(?:sil|[cm]?[jt]sx?|mdx?|jsonc?)$/i;

/**
 * Code outline for the active editor file:
 * - SilverScript (`.sil`): full contract breakdown (constructor params, entries with require counts/#tag, compiled P2SH, deployments)
 * - TypeScript / JavaScript / Markdown / JSON: navigable symbol tree (`extractDocumentSymbols`) synchronized with cursor line.
 */
export function Outline() {
  const engine = useEngine();
  const file = useIde((s) => s.openFiles.find((f) => f.path === s.activeFile));
  const setOutlineOpen = useIde((s) => s.setOutlineOpen);
  const compiled = useSilver((s) => s.compiled);
  const deployments = useSilver((s) => s.deployments);
  const cursorFile = useEditorCursor((s) => s.file);
  const cursorLine = useEditorCursor((s) => s.line);

  const isTextDoc = Boolean(file && file.kind !== "view");
  const isSil = isTextDoc && (file?.path.toLowerCase().endsWith(".sil") ?? false);
  const isSupported = isTextDoc && SUPPORTED_EXT_RE.test(file?.path ?? "");
  const deferredContent = useDeferredValue(file?.content);

  const silOutline = useMemo(
    () => (isSil && deferredContent !== undefined ? parseSilOutline(deferredContent) : null),
    [isSil, deferredContent]
  );
  const symbols = useMemo(
    () => (!isSil && isSupported && file && deferredContent !== undefined ? extractDocumentSymbols(file.path, deferredContent) : []),
    [isSil, isSupported, file, deferredContent]
  );
  const effectiveLine = file && cursorFile === file.path ? cursorLine : 0;
  const activeTrail = useMemo(
    () => (effectiveLine > 0 ? new Set(activeSymbolTrail(symbols, effectiveLine).map((s) => s.id)) : new Set<string>()),
    [symbols, effectiveLine]
  );

  const symbolGroups = useMemo(() => {
    const childrenByParent = new Map<string, DocumentSymbol[]>();
    const roots: DocumentSymbol[] = [];
    for (const sym of symbols) {
      if (sym.parentId) {
        const list = childrenByParent.get(sym.parentId) ?? [];
        list.push(sym);
        childrenByParent.set(sym.parentId, list);
      } else {
        roots.push(sym);
      }
    }
    return { roots, childrenByParent };
  }, [symbols]);

  const compiledForFile = compiled && file && compiled.sourcePath === file.path ? compiled : null;
  const goto = (line: number) => engine.get<EditorPlugin>("editor").gotoLine(line);

  return (
    <aside className="h-full bg-bg-panel panel-card flex flex-col text-xs min-w-0">
      <header className="panel-title flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <ListTree size={13} /> Outline
          {!isSil && symbols.length > 0 && <span className="text-[11px] font-normal text-fg-muted tabular-nums">({symbols.length})</span>}
        </span>
        <button
          type="button"
          onClick={() => setOutlineOpen(false)}
          className="p-0.5 rounded text-fg-muted hover:text-fg hover:bg-bg-hover normal-case cursor-pointer"
          title="Hide outline"
          aria-label="Hide outline"
        >
          <X size={13} />
        </button>
      </header>
      <div className="flex-1 min-h-0 overflow-auto py-1">
        {!isTextDoc && <div className="px-3 py-2 text-fg-muted">Open a file to see its outline.</div>}
        {isTextDoc && !isSupported && (
          <div className="px-3 py-2 text-fg-muted">No outline available for this file type.</div>
        )}
        {isTextDoc && !isSil && isSupported && symbols.length === 0 && (
          <div className="px-3 py-2 text-fg-muted">No symbols found in this file.</div>
        )}

        {silOutline && (
          <>
            {silOutline.pragma && (
              <div className="px-3 py-1 text-fg-muted">
                pragma silverscript <span className="text-fg font-mono">{silOutline.pragma}</span>
              </div>
            )}
            {silOutline.contracts.length === 0 && <div className="px-3 py-2 text-fg-muted">No contract found yet.</div>}
            {silOutline.contracts.map((c) => {
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
                      const activeEntry = effectiveLine >= e.line && effectiveLine <= e.endLine;
                      return (
                        <Row
                          key={e.name}
                          icon={<FunctionSquare size={11} className="text-warn shrink-0" />}
                          label={`${e.name}(${e.params.map((p) => `${p.type} ${p.name}`).join(", ")})`}
                          value={`${e.requires} require${e.requires === 1 ? "" : "s"}${tag ? ` · #${tag}` : ""}`}
                          active={activeEntry}
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

        {!isSil && symbolGroups.roots.map((sym) => {
          const children = symbolGroups.childrenByParent.get(sym.id) ?? [];
          if (children.length > 0) {
            return (
              <Section
                key={sym.id}
                icon={<SymbolIcon kind={sym.kind} />}
                title={sym.name}
                hint={`Ln ${sym.line}`}
                active={activeTrail.has(sym.id)}
                onClick={() => goto(sym.line)}
              >
                {children.map((child) => (
                  <Row
                    key={child.id}
                    icon={<SymbolIcon kind={child.kind} />}
                    label={child.name}
                    value={child.detail && child.detail !== child.kind ? `${child.detail} · Ln ${child.line}` : `Ln ${child.line}`}
                    active={activeTrail.has(child.id)}
                    onClick={() => goto(child.line)}
                    title={`${child.name} (line ${child.line})`}
                  />
                ))}
              </Section>
            );
          }

          const mdIndent = sym.kind === "heading" && sym.detail ? (sym.detail.length - 1) * 10 : 0;
          const rightText = sym.kind === "heading" ? `Ln ${sym.line}` : sym.detail ? `${sym.detail} · Ln ${sym.line}` : `Ln ${sym.line}`;
          return (
            <Row
              key={sym.id}
              icon={<SymbolIcon kind={sym.kind} />}
              label={sym.name}
              value={rightText}
              indentPx={10 + mdIndent}
              active={activeTrail.has(sym.id)}
              onClick={() => goto(sym.line)}
              title={`${sym.kind} ${sym.name} (line ${sym.line})`}
            />
          );
        })}
      </div>
    </aside>
  );
}

function Section({
  icon,
  title,
  hint,
  active,
  onClick,
  children
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        className={clsx("flex items-center gap-1 px-2 py-1 hover:bg-bg-hover cursor-pointer outline-none", active && "bg-accent/10")}
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
        {hint && <span className="ml-auto text-[12px] text-fg-muted whitespace-nowrap tabular-nums">{hint}</span>}
      </div>
      {open && <div className="pb-1">{children}</div>}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-0.5">
      <div className="pl-7 text-[12px] uppercase tracking-wider text-fg-muted select-none">{title}</div>
      {children}
    </div>
  );
}

function Row({
  icon,
  label,
  value,
  mono,
  indentPx,
  active,
  onClick,
  title
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  mono?: boolean;
  indentPx?: number;
  active?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      style={indentPx !== undefined ? { paddingLeft: indentPx } : undefined}
      className={clsx(
        "flex items-center gap-1.5 pr-2 py-0.5 min-w-0 outline-none",
        indentPx === undefined && "pl-7",
        active && "bg-accent/15",
        onClick && "cursor-pointer hover:bg-bg-hover"
      )}
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
      {value && <span className={clsx("ml-auto text-[12px] text-fg-muted truncate max-w-[55%] tabular-nums", mono && "font-mono")}>{value}</span>}
    </div>
  );
}
