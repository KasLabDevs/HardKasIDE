import clsx from "clsx";
import {
  AlertCircle,
  AlertTriangle,
  Box,
  Braces,
  ChevronRight,
  FlaskConical,
  Folder,
  FunctionSquare,
  Hash
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { TreeNode } from "@/api/client";
import { FileIcon } from "@/components/FileIcon";
import { useEngine } from "@/engine/context";
import type { EditorPlugin } from "@/plugins/editor";
import { useEditorCursor } from "@/store/editorCursor";
import { useIde, type OpenFile } from "@/store/ide";
import {
  activeSymbolTrail,
  collectBreadcrumbTreeSegments,
  extractDocumentSymbols,
  type DocumentSymbol,
  type SymbolKind
} from "@/utils/symbols";

type MenuState =
  | { kind: "tree"; anchorId: string; title: string; nodes: TreeNode[] }
  | { kind: "symbols"; anchorId: string };

/**
 * Compact VS Code-style breadcrumbs bar above Monaco: folder > file > active symbol (e.g. Contract > entry)
 * synchronized with cursor position, plus inline quick-pickers and file diagnostics badge.
 */
export function Breadcrumbs({ file }: { file: OpenFile }) {
  const engine = useEngine();
  const tree = useIde((s) => s.tree);
  const cursorFile = useEditorCursor((s) => s.file);
  const cursorLine = useEditorCursor((s) => s.line);
  const errors = useEditorCursor((s) => s.errors);
  const warnings = useEditorCursor((s) => s.warnings);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const deferredContent = useDeferredValue(file.content);
  const symbols = useMemo(
    () => extractDocumentSymbols(file.path, deferredContent),
    [file.path, deferredContent]
  );
  const effectiveLine = cursorFile === file.path ? cursorLine : 1;
  const trail = useMemo(() => activeSymbolTrail(symbols, effectiveLine), [symbols, effectiveLine]);
  const { folders, fileSiblings } = useMemo(
    () => collectBreadcrumbTreeSegments(tree, file.path),
    [tree, file.path]
  );

  useEffect(() => {
    setMenu(null);
  }, [file.path]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const fileName = file.path.split("/").pop() ?? file.path;
  const showDiags = cursorFile === file.path && (errors > 0 || warnings > 0);

  const toggleMenu = (next: MenuState) => {
    setMenu((cur) => (cur?.anchorId === next.anchorId ? null : next));
  };

  const openTreeFile = (path: string) => {
    setMenu(null);
    void engine.call("fileManager", "open", path);
  };

  const gotoSymbol = (sym: DocumentSymbol) => {
    setMenu(null);
    engine.get<EditorPlugin>("editor").gotoLine(sym.line);
  };

  return (
    <div
      ref={wrapRef}
      aria-label="Breadcrumbs"
      className="relative h-[22px] shrink-0 flex items-center gap-1 px-2 border-b border-border/70 bg-bg text-[12px] leading-none text-fg-muted select-none"
    >
      <div className="flex items-center gap-0.5 min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">
        {folders.map((seg) => {
          const folderNode = seg.items.find((n) => n.type === "dir" && n.name === seg.label);
          const dropdownNodes = folderNode?.children ?? seg.items;
          const isOpen = menu?.kind === "tree" && menu.anchorId === `dir:${seg.dirPath}`;
          return (
            <span key={seg.dirPath} className="inline-flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                onClick={() => toggleMenu({ kind: "tree", anchorId: `dir:${seg.dirPath}`, title: seg.label, nodes: dropdownNodes })}
                className={clsx(
                  "inline-flex items-center gap-1 px-1 py-0.5 rounded hover:bg-bg-hover hover:text-fg cursor-pointer transition-colors",
                  isOpen && "bg-bg-hover text-fg"
                )}
                title={seg.dirPath}
              >
                <Folder size={11} className="text-fg-muted shrink-0" />
                <span>{seg.label}</span>
              </button>
              <ChevronRight size={11} className="text-fg-muted/60 shrink-0" />
            </span>
          );
        })}

        <button
          type="button"
          onClick={() => toggleMenu({ kind: "tree", anchorId: `file:${file.path}`, title: "Files in folder", nodes: fileSiblings })}
          className={clsx(
            "inline-flex items-center gap-1 px-1 py-0.5 rounded hover:bg-bg-hover hover:text-fg cursor-pointer transition-colors shrink-0",
            menu?.anchorId === `file:${file.path}` && "bg-bg-hover text-fg",
            trail.length === 0 && "text-fg"
          )}
          title={file.path}
        >
          <FileIcon name={file.path} size={12} />
          <span>{fileName}</span>
        </button>

        {trail.map((sym, idx) => (
          <span key={sym.id} className="inline-flex items-center gap-0.5 shrink-0">
            <ChevronRight size={11} className="text-fg-muted/60 shrink-0" />
            <button
              type="button"
              onClick={() => toggleMenu({ kind: "symbols", anchorId: `sym:${sym.id}` })}
              className={clsx(
                "inline-flex items-center gap-1 px-1 py-0.5 rounded hover:bg-bg-hover hover:text-fg cursor-pointer transition-colors",
                idx === trail.length - 1 ? "text-fg font-medium" : "text-fg-muted",
                menu?.anchorId === `sym:${sym.id}` && "bg-bg-hover text-fg"
              )}
              title={`${sym.name}${sym.detail ? ` ${sym.detail}` : ""} · Ln ${sym.line}`}
            >
              <SymbolIcon kind={sym.kind} />
              <span>{sym.name}</span>
              {sym.kind === "entry" && sym.detail && (
                <span className="text-[12px] text-fg-muted hidden lg:inline">{sym.detail.split(" · ")[0]}</span>
              )}
            </button>
          </span>
        ))}

        {trail.length === 0 && symbols.length > 0 && (
          <span className="inline-flex items-center gap-0.5 shrink-0">
            <ChevronRight size={11} className="text-fg-muted/60 shrink-0" />
            <button
              type="button"
              onClick={() => toggleMenu({ kind: "symbols", anchorId: "sym:list" })}
              className={clsx(
                "inline-flex items-center gap-1 px-1 py-0.5 rounded hover:bg-bg-hover hover:text-fg cursor-pointer transition-colors",
                menu?.anchorId === "sym:list" && "bg-bg-hover text-fg"
              )}
              title="Jump to symbol in file"
            >
              <span>{symbols.length} symbols</span>
            </button>
          </span>
        )}
      </div>

      {showDiags && (
        <button
          type="button"
          onClick={() => engine.get<EditorPlugin>("editor").trigger("editor.action.marker.next")}
          className="ml-2 inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded hover:bg-bg-hover cursor-pointer shrink-0 tabular-nums"
          title="Jump to next problem in file (F8)"
        >
          {errors > 0 && (
            <span className="inline-flex items-center gap-0.5 text-error">
              <AlertCircle size={11} /> {errors}
            </span>
          )}
          {warnings > 0 && (
            <span className="inline-flex items-center gap-0.5 text-warn">
              <AlertTriangle size={11} /> {warnings}
            </span>
          )}
        </button>
      )}

      {menu && (
        <div
          role="menu"
          aria-label="Breadcrumb navigation"
          className="absolute left-2 top-full mt-0.5 z-40 w-80 max-w-[calc(100vw-2rem)] max-h-72 overflow-auto rounded border border-border bg-bg-elev shadow-2xl py-1 text-xs"
        >
          {menu.kind === "tree" ? (
            <>
              <div className="px-2.5 py-1 text-[12px] uppercase tracking-wider text-fg-muted border-b border-border/60">
                {menu.title}
              </div>
              {menu.nodes.length === 0 && (
                <div className="px-3 py-2 text-fg-muted">No files found at this level.</div>
              )}
              {menu.nodes.map((node) => {
                const isCurrent = node.path === file.path;
                return (
                  <button
                    key={node.path}
                    type="button"
                    role="menuitem"
                    disabled={node.type === "dir"}
                    onClick={() => node.type === "file" && openTreeFile(node.path)}
                    className={clsx(
                      "w-full text-left px-2.5 py-1 flex items-center gap-2 transition-colors",
                      node.type === "dir"
                        ? "text-fg-muted/70 cursor-default"
                        : isCurrent
                          ? "bg-accent/15 text-fg font-medium cursor-pointer"
                          : "text-fg hover:bg-bg-hover cursor-pointer"
                    )}
                  >
                    {node.type === "dir" ? <Folder size={12} className="shrink-0" /> : <FileIcon name={node.path} size={13} />}
                    <span className="truncate flex-1">{node.name}</span>
                    {isCurrent && <span className="text-[12px] text-accent shrink-0">active</span>}
                  </button>
                );
              })}
            </>
          ) : (
            <>
              <div className="px-2.5 py-1 text-[12px] uppercase tracking-wider text-fg-muted border-b border-border/60">
                Symbols in {fileName}
              </div>
              {symbols.length === 0 && <div className="px-3 py-2 text-fg-muted">No symbols in this file.</div>}
              {symbols.map((sym) => {
                const isActive = trail.some((t) => t.id === sym.id);
                return (
                  <button
                    key={sym.id}
                    type="button"
                    role="menuitem"
                    onClick={() => gotoSymbol(sym)}
                    className={clsx(
                      "w-full text-left px-2.5 py-1 flex items-center gap-2 hover:bg-bg-hover cursor-pointer transition-colors",
                      sym.parentId && "pl-6",
                      isActive && "bg-accent/15 text-fg"
                    )}
                  >
                    <SymbolIcon kind={sym.kind} />
                    <span className="truncate font-medium text-fg">{sym.name}</span>
                    {sym.detail && <span className="truncate text-[12px] text-fg-muted flex-1">{sym.detail}</span>}
                    <span className="ml-auto text-[12px] text-fg-muted tabular-nums shrink-0">Ln {sym.line}</span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function SymbolIcon({ kind }: { kind: SymbolKind }) {
  switch (kind) {
    case "contract":
      return <Box size={11} className="text-accent shrink-0" />;
    case "entry":
      return <FunctionSquare size={11} className="text-warn shrink-0" />;
    case "test":
      return <FlaskConical size={11} className="text-ok shrink-0" />;
    case "heading":
      return <Hash size={11} className="text-info shrink-0" />;
    case "key":
      return <Braces size={11} className="text-info shrink-0" />;
    default:
      return <FunctionSquare size={11} className="text-info shrink-0" />;
  }
}
