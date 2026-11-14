import clsx from "clsx";
import {
  Bug,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FilePlus2,
  FolderPlus,
  Hammer,
  PackageOpen,
  Pencil,
  Play,
  RefreshCw,
  Rocket,
  RotateCw,
  ShieldAlert,
  Sparkles,
  TerminalSquare,
  Trash2
} from "lucide-react";
import { useEffect, useState } from "react";
import type { TreeNode } from "@/api/client";
import { FileIcon } from "@/components/FileIcon";
import { useEngine } from "@/engine/context";
import type { CompilerPlugin } from "@/plugins/compiler";
import type { SilverPlugin } from "@/plugins/silver";
import { EclipseTypeBadge, openNewArtifactWizard } from "@/shell/NewArtifactDialog";
import { useIde } from "@/store/ide";
import { copyText } from "@/utils/clipboard";
import { confirmDialog, promptDialog } from "@/utils/dialog";

interface MenuState {
  x: number;
  y: number;
  node: TreeNode;
}

export function FilesPanel() {
  const engine = useEngine();
  const tree = useIde((s) => s.tree);
  const workspace = useIde((s) => s.workspace);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [collapseSeq, setCollapseSeq] = useState(0);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await engine.call("fileManager", "refresh");
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const openRootContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      node: { name: workspace?.name ?? "root", path: "", type: "dir", children: tree }
    });
  };

  return (
    <div className="text-xs select-none min-h-full flex flex-col">
      <div
        className="flex items-center gap-0.5 px-2 py-1 border-b border-border text-fg-muted"
        onContextMenu={openRootContextMenu}
      >
        <span className="truncate flex-1 font-medium text-fg" title={workspace?.root ?? ""}>
          {workspace?.name ?? "—"}
        </span>
        <button
          type="button"
          title="New (Ctrl+N)…"
          aria-label="New file"
          onClick={() => openNewArtifactWizard()}
          className="p-1 rounded hover:text-fg hover:bg-bg-hover cursor-pointer"
        >
          <FilePlus2 size={14} />
        </button>
        <button
          type="button"
          title="New folder…"
          aria-label="New folder"
          onClick={() => openNewArtifactWizard({ templateId: "folder" })}
          className="p-1 rounded hover:text-fg hover:bg-bg-hover cursor-pointer"
        >
          <FolderPlus size={14} />
        </button>
        <button
          type="button"
          title="Refresh Explorer (F5)"
          aria-label="Refresh Explorer"
          onClick={() => void refresh()}
          className="p-1 rounded hover:text-fg hover:bg-bg-hover cursor-pointer"
        >
          <RotateCw size={14} className={refreshing ? "animate-spin text-accent" : ""} />
        </button>
        <button
          type="button"
          title="Collapse Folders in Explorer"
          aria-label="Collapse Folders in Explorer"
          onClick={() => setCollapseSeq((s) => s + 1)}
          className="p-1 rounded hover:text-fg hover:bg-bg-hover cursor-pointer"
        >
          <CollapseFoldersIcon size={14} />
        </button>
      </div>
      <div
        role="tree"
        aria-label="Workspace files"
        className="py-1 flex-1"
        onContextMenu={(e) => {
          if (e.target === e.currentTarget) openRootContextMenu(e);
        }}
      >
        {tree.length === 0 && (
          <div className="px-3 py-4 text-center space-y-2 text-fg-muted">
            <div>Empty workspace.</div>
            <button type="button" className="btn-ghost w-full justify-center" onClick={() => openNewArtifactWizard()}>
              <FilePlus2 size={13} /> New file / contract…
            </button>
          </div>
        )}
        {/* The project's own files first; dot-folders such as .hardkas (HardKas runtime state) go last, collapsed. */}
        {sortProjectFirst(tree).map((node) => (
          <Node key={node.path} node={node} depth={0} collapseSeq={collapseSeq} onMenu={(x, y, n) => setMenu({ x, y, node: n })} />
        ))}
      </div>
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** Stacked folder-box minus glyph matching VS Code's Collapse Folders in Explorer action. */
function CollapseFoldersIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.35}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2.5" y="2.5" width="9" height="9" rx="1.5" />
      <path d="M5 7H9" />
      <path d="M5.5 13.5H12C12.8284 13.5 13.5 12.8284 13.5 12V5.5" />
    </svg>
  );
}

const isInternal = (n: TreeNode) => n.name.startsWith(".");

function sortProjectFirst(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) => {
    const ia = isInternal(a) ? 1 : 0;
    const ib = isInternal(b) ? 1 : 0;
    if (ia !== ib) return ia - ib;
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function Node({
  node,
  depth,
  collapseSeq,
  onMenu,
}: {
  node: TreeNode;
  depth: number;
  collapseSeq: number;
  onMenu: (x: number, y: number, n: TreeNode) => void;
}) {
  const engine = useEngine();
  const activeFile = useIde((s) => s.activeFile);
  const internal = isInternal(node);
  const [open, setOpen] = useState(depth < 1 && !internal);
  const isDir = node.type === "dir";
  const isActive = node.path === activeFile;

  useEffect(() => {
    if (collapseSeq > 0) setOpen(false);
  }, [collapseSeq]);

  const onActivate = () => {
    if (isDir) setOpen((o) => !o);
    else void engine.call("fileManager", "open", node.path);
  };

  return (
    <div role="none">
      <div
        role="treeitem"
        tabIndex={0}
        aria-expanded={isDir ? open : undefined}
        aria-selected={isActive}
        onClick={onActivate}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onActivate();
          } else if (isDir && e.key === "ArrowRight" && !open) {
            e.preventDefault();
            setOpen(true);
          } else if (isDir && e.key === "ArrowLeft" && open) {
            e.preventDefault();
            setOpen(false);
          } else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
            e.preventDefault();
            const rect = e.currentTarget.getBoundingClientRect();
            onMenu(rect.left + 24, rect.bottom, node);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onMenu(e.clientX, e.clientY, node);
        }}
        className={clsx(
          "group flex items-center gap-1.5 pr-2 py-0.5 cursor-pointer hover:bg-bg-hover outline-none",
          isActive && "bg-bg-hover text-fg font-medium",
          internal && "opacity-60"
        )}
        style={{ paddingLeft: 8 + depth * 12 }}
        title={internal && depth === 0 ? `${node.path} (HardKas runtime state: artifacts, accounts, node data)` : node.path}
      >
        {isDir ? (
          <span className="w-4 flex items-center justify-center text-fg-muted shrink-0">
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
        ) : (
          <FileIcon name={node.name} size={15} />
        )}
        <span className="truncate flex-1">{node.name}</span>
        {internal && depth === 0 && isDir && <span className="text-[12px] text-fg-muted shrink-0">state</span>}
      </div>
      {isDir && open && (
        <div role="group" className="relative">
          <div
            className="absolute top-0 bottom-0 w-px bg-border/80 pointer-events-none"
            style={{ left: 15 + depth * 12 }}
          />
          {sortProjectFirst(node.children ?? []).map((child) => (
            <Node key={child.path} node={child} depth={depth + 1} collapseSeq={collapseSeq} onMenu={onMenu} />
          ))}
        </div>
      )}
    </div>
  );
}

type ContextEntry =
  | "sep"
  | {
      id: string;
      label: string;
      shortcut?: string;
      icon: React.ReactNode;
      danger?: boolean;
      run?: () => void;
      children?: ContextEntry[];
    };

/**
 * Eclipse-style Project Explorer context menu with cascading submenus:
 *   New > [File, Folder, SQL File | SilverScript Contract, Covenant 1:N, Covenant 1:1, Escrow, Timelock | Class, Interface, Enum, Record, Test Suite | Other…]
 *   Show In > [Terminal, Deploy & Run, Index, Lineage Graph, Covenant Graph]
 *   Run As > [Compile SilverScript, Compile & Deploy, Audit Security, Vitest Suite]
 *   Debug As > [Vitest Debugger]
 */
function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const engine = useEngine();
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>("new");
  const n = menu.node;
  const isSil = n.type === "file" && n.name.endsWith(".sil");
  const isTest = n.type === "file" && /\.(test|spec)\.[cm]?[jt]sx?$/.test(n.name);
  const isDeploy = n.type === "file" && /silverDeploy-.*\.json$/.test(n.name);
  const targetFolder = n.type === "dir" ? n.path : n.path.includes("/") ? n.path.slice(0, n.path.lastIndexOf("/")) : "";
  const fm = (method: string, ...args: unknown[]) => void engine.call("fileManager", method, ...args);

  const compile = async (thenDeploy: boolean) => {
    await engine.call("fileManager", "open", n.path);
    const result = await engine.get<CompilerPlugin>("silverCompiler").compile(n.path);
    if (thenDeploy && result.ok) useIde.getState().setActiveSidePlugin("deployRun");
  };

  const newSubmenu: ContextEntry[] = [
    {
      id: "new-file",
      label: "File",
      icon: <EclipseTypeBadge text="FILE" tone="slate" />,
      run: () => openNewArtifactWizard({ folder: targetFolder, templateId: "empty-file" })
    },
    {
      id: "new-folder",
      label: "Folder",
      icon: <EclipseTypeBadge text="DIR" tone="amber" />,
      run: () => openNewArtifactWizard({ folder: targetFolder, templateId: "folder" })
    },
    {
      id: "new-sql",
      label: "SQL File",
      icon: <EclipseTypeBadge text="SQL" tone="sky" />,
      run: () => openNewArtifactWizard({ folder: targetFolder || "queries", templateId: "sql-file" })
    },
    "sep",
    {
      id: "new-silver-basic",
      label: "SilverScript Contract",
      icon: <EclipseTypeBadge text="S" tone="green" />,
      run: () => openNewArtifactWizard({ folder: targetFolder || "contracts", templateId: "silver-basic" })
    },
    {
      id: "new-covenant-1-n",
      label: "Covenant 1:N (Splitter)",
      icon: <EclipseTypeBadge text="1:N" tone="teal" />,
      run: () => openNewArtifactWizard({ folder: targetFolder || "contracts", templateId: "covenant-1-n" })
    },
    {
      id: "new-covenant-1-1",
      label: "Covenant 1:1 (Vault)",
      icon: <EclipseTypeBadge text="1:1" tone="sky" />,
      run: () => openNewArtifactWizard({ folder: targetFolder || "contracts", templateId: "covenant-1-1" })
    },
    {
      id: "new-covenant-escrow",
      label: "Escrow 2-of-3 Covenant",
      icon: <EclipseTypeBadge text="E" tone="amber" />,
      run: () => openNewArtifactWizard({ folder: targetFolder || "contracts", templateId: "covenant-escrow" })
    },
    {
      id: "new-covenant-timelock",
      label: "Timelock Covenant",
      icon: <EclipseTypeBadge text="T" tone="blue" />,
      run: () => openNewArtifactWizard({ folder: targetFolder || "contracts", templateId: "covenant-timelock" })
    },
    "sep",
    {
      id: "new-ts-class",
      label: "Class",
      icon: <EclipseTypeBadge text="C" tone="green" />,
      run: () => openNewArtifactWizard({ folder: targetFolder || "scripts", templateId: "ts-class" })
    },
    {
      id: "new-ts-interface",
      label: "Interface",
      icon: <EclipseTypeBadge text="I" tone="purple" />,
      run: () => openNewArtifactWizard({ folder: targetFolder || "scripts", templateId: "ts-interface" })
    },
    {
      id: "new-ts-enum",
      label: "Enum",
      icon: <EclipseTypeBadge text="E" tone="amber" />,
      run: () => openNewArtifactWizard({ folder: targetFolder || "scripts", templateId: "ts-enum" })
    },
    {
      id: "new-ts-record",
      label: "Record",
      icon: <EclipseTypeBadge text="R" tone="gold" />,
      run: () => openNewArtifactWizard({ folder: targetFolder || "scripts", templateId: "ts-record" })
    },
    {
      id: "new-ts-test",
      label: "Test Suite",
      icon: <EclipseTypeBadge text="T" tone="teal" />,
      run: () => openNewArtifactWizard({ folder: targetFolder || "test", templateId: "ts-contract-test" })
    },
    "sep",
    {
      id: "new-other",
      label: "Other…",
      shortcut: "Ctrl+N",
      icon: <Sparkles size={13} className="text-accent" />,
      run: () => openNewArtifactWizard({ folder: targetFolder })
    }
  ];

  const showInSubmenu: ContextEntry[] = [
    {
      id: "show-terminal",
      label: "Local Terminal",
      icon: <TerminalSquare size={13} className="text-accent" />,
      run: () => {
        useIde.getState().setTerminalOpen(true);
        useIde.getState().requestTerminal();
      }
    },
    {
      id: "show-deploy",
      label: "Deploy & Run",
      icon: <Rocket size={13} className="text-accent" />,
      run: () => useIde.getState().setActiveSidePlugin("deployRun")
    },
    {
      id: "show-index",
      label: "Index (Query Store)",
      icon: <ExternalLink size={13} className="text-fg-muted" />,
      run: () => void engine.call("queryIndex", "open")
    },
    {
      id: "show-lineage",
      label: "Lineage Graph",
      icon: <ExternalLink size={13} className="text-fg-muted" />,
      run: () => void engine.call("lineage", "open")
    },
    {
      id: "show-covenant",
      label: "Covenant Graph",
      icon: <ExternalLink size={13} className="text-fg-muted" />,
      run: () => void engine.call("covenant", "open")
    }
  ];

  const runAsSubmenu: ContextEntry[] = [];
  if (isSil) {
    runAsSubmenu.push(
      {
        id: "run-compile",
        label: "1 SilverScript Compiler",
        shortcut: "Ctrl+Enter",
        icon: <Hammer size={13} className="text-accent" />,
        run: () => void compile(false)
      },
      {
        id: "run-deploy",
        label: "2 Compile & Deploy…",
        icon: <Rocket size={13} className="text-ok" />,
        run: () => void compile(true)
      },
      {
        id: "run-audit",
        label: "3 SilverScript Security Audit",
        icon: <ShieldAlert size={13} className="text-warn" />,
        run: () => void engine.get<CompilerPlugin>("silverCompiler").audit(n.path)
      }
    );
  }
  if (isTest) {
    runAsSubmenu.push({
      id: "run-vitest",
      label: "1 Vitest Test Suite",
      icon: <Play size={13} className="text-ok" />,
      run: () => void engine.call("tests", "runFile", n.path)
    });
  }
  runAsSubmenu.push({
    id: "run-all-tests",
    label: "Run All Workspace Tests",
    icon: <Play size={13} className="text-fg-muted" />,
    run: () => void engine.call("tests", "run")
  });

  const entries: ContextEntry[] = [
    {
      id: "new",
      label: "New",
      icon: <FilePlus2 size={13} className="text-accent" />,
      children: newSubmenu
    }
  ];

  if (n.type === "file") {
    entries.push({
      id: "open",
      label: "Open",
      shortcut: "Enter",
      icon: <FileIcon name={n.name} size={13} />,
      run: () => fm("open", n.path)
    });
  }

  entries.push({
    id: "show-in",
    label: "Show In",
    shortcut: "Alt+Shift+W",
    icon: <ExternalLink size={13} />,
    children: showInSubmenu
  });

  if (isDeploy) {
    entries.push(
      "sep",
      {
        id: "load-deployed",
        label: "Load as Deployed Contract",
        icon: <PackageOpen size={13} className="text-accent" />,
        run: () => {
          void engine.get<SilverPlugin>("silverContracts").loadDeployRecord(n.path);
          useIde.getState().setActiveSidePlugin("deployRun");
        }
      }
    );
  }

  if (n.path) {
    entries.push(
      "sep",
      {
        id: "copy-path",
        label: "Copy Path",
        shortcut: "Ctrl+C",
        icon: <Copy size={13} />,
        run: () => void copyText(n.path)
      },
      {
        id: "rename",
        label: "Rename…",
        shortcut: "F2",
        icon: <Pencil size={13} />,
        run: async () => {
          const to = await promptDialog(`Rename ${n.path} to:`, n.path, { title: "Rename", confirmLabel: "Rename" });
          if (to && to !== n.path) fm("rename", n.path, to);
        }
      },
      {
        id: "delete",
        label: "Delete",
        shortcut: "Delete",
        icon: <Trash2 size={13} />,
        danger: true,
        run: async () => {
          if (await confirmDialog(`Delete ${n.path}?`, { title: "Delete Resource", confirmLabel: "Delete", danger: true })) fm("remove", n.path);
        }
      }
    );
  }

  entries.push(
    "sep",
    {
      id: "refresh",
      label: "Refresh",
      shortcut: "F5",
      icon: <RefreshCw size={13} />,
      run: () => fm("refresh")
    },
    "sep",
    {
      id: "run-as",
      label: "Run As",
      icon: <Play size={13} className="text-ok" />,
      children: runAsSubmenu
    }
  );

  if (isTest) {
    entries.push({
      id: "debug-as",
      label: "Debug As",
      icon: <Bug size={13} className="text-warn" />,
      children: [
        {
          id: "debug-vitest",
          label: "1 Vitest Test Debugger",
          shortcut: "F5",
          icon: <Bug size={13} className="text-warn" />,
          run: () => void engine.call("debug", "debugFile", n.path).catch((e: unknown) => engine.call("console", "error", String(e)))
        }
      ]
    });
  }

  const menuWidth = 196;
  const subWidth = 190;
  const x = Math.min(menu.x, Math.max(8, window.innerWidth - menuWidth - 16));
  const y = Math.min(menu.y, Math.max(8, window.innerHeight - 320));
  const openRight = x + menuWidth + subWidth + 12 <= window.innerWidth;

  return (
    <ul
      role="menu"
      aria-label={`Actions for ${n.name}`}
      className="fixed z-50 w-max min-w-[172px] max-w-[240px] rounded border border-border bg-bg-elev shadow-2xl py-0.5 text-[12px] select-none"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      {n.path && (
        <li role="presentation" className="px-2.5 py-[3px] text-[12px] font-mono text-fg-muted border-b border-border/60 mb-0.5 truncate">
          {n.type === "dir" ? `📁 ${n.path}/` : n.path}
        </li>
      )}
      {entries.map((it, i) =>
        it === "sep" ? (
          <li key={`sep-${i}`} role="separator" className="my-0.5 border-t border-border" />
        ) : (
          <li
            key={it.id}
            role="none"
            className="relative"
            onMouseEnter={() => setActiveSubmenu(it.children ? it.id : null)}
          >
            <button
              type="button"
              role="menuitem"
              aria-haspopup={it.children ? "menu" : undefined}
              aria-expanded={it.children ? activeSubmenu === it.id : undefined}
              onClick={() => {
                if (it.children) {
                  setActiveSubmenu(it.id);
                  return;
                }
                onClose();
                it.run?.();
              }}
              className={clsx(
                "w-full text-left px-2.5 py-[3px] flex items-center justify-between gap-4 whitespace-nowrap cursor-pointer hover:bg-bg-hover",
                activeSubmenu === it.id && it.children && "bg-bg-hover",
                it.danger ? "text-error" : "text-fg"
              )}
            >
              <span className="flex items-center gap-2 min-w-0 truncate">
                {it.icon}
                <span className="truncate">{it.label}</span>
              </span>
              <span className="flex items-center gap-1 shrink-0 text-[12px] text-fg-muted">
                {it.shortcut && <span>{it.shortcut}</span>}
                {it.children && <ChevronRight size={12} />}
              </span>
            </button>

            {it.children && activeSubmenu === it.id && (
              <ul
                role="menu"
                aria-label={`${it.label} submenu`}
                className="absolute top-0 w-max min-w-[162px] max-w-[240px] rounded border border-border bg-bg-elev shadow-2xl py-0.5 text-[12px] z-50"
                style={openRight ? { left: "100%", marginLeft: 2 } : { right: "100%", marginRight: 2 }}
              >
                {it.children.map((sub, si) =>
                  sub === "sep" ? (
                    <li key={`subsep-${si}`} role="separator" className="my-0.5 border-t border-border" />
                  ) : (
                    <li key={sub.id} role="none">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          onClose();
                          sub.run?.();
                        }}
                        className="w-full text-left px-2.5 py-[3px] flex items-center justify-between gap-4 whitespace-nowrap cursor-pointer hover:bg-bg-hover text-fg"
                      >
                        <span className="flex items-center gap-2 min-w-0 truncate">
                          {sub.icon}
                          <span className="truncate">{sub.label}</span>
                        </span>
                        {sub.shortcut && <span className="text-[12px] text-fg-muted shrink-0">{sub.shortcut}</span>}
                      </button>
                    </li>
                  )
                )}
              </ul>
            )}
          </li>
        )
      )}
    </ul>
  );
}
