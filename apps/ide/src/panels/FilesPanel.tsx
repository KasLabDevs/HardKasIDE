import clsx from "clsx";
import { ChevronDown, ChevronRight, Copy, File, FileCode2, FilePlus2, Folder, FolderOpen, FolderPlus, Hammer, PackageOpen, Pencil, RefreshCw, Rocket, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { TreeNode } from "@/api/client";
import { useEngine } from "@/engine/context";
import type { CompilerPlugin } from "@/plugins/compiler";
import type { SilverPlugin } from "@/plugins/silver";
import { useIde } from "@/store/ide";

interface MenuState {
  x: number;
  y: number;
  node: TreeNode;
}

export function FilesPanel() {
  const engine = useEngine();
  const tree = useIde((s) => s.tree);
  const workspace = useIde((s) => s.workspace);
  const [creating, setCreating] = useState<"file" | "dir" | null>(null);
  const [newName, setNewName] = useState("");
  const [menu, setMenu] = useState<MenuState | null>(null);

  const refresh = () => void engine.call("fileManager", "refresh");

  const confirmCreate = async () => {
    const name = newName.trim();
    setCreating(null);
    setNewName("");
    if (!name) return;
    if (creating === "dir") await engine.call("fileManager", "mkdir", name);
    else await engine.call("fileManager", "createFile", name, name.endsWith(".sil") ? "pragma silverscript ^0.1.0;\n\ncontract Hello(pubkey owner) {\n  entry spend(sig s) {\n    require(checkSig(s, owner));\n  }\n}\n" : "");
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

  return (
    <div className="text-xs select-none">
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border text-fg-muted">
        <span className="truncate flex-1 font-medium text-fg" title={workspace?.root ?? ""}>
          {workspace?.name ?? "—"}
        </span>
        <button type="button" title="New file" aria-label="New file" onClick={() => setCreating("file")} className="p-1 rounded hover:text-fg hover:bg-bg-hover cursor-pointer">
          <FilePlus2 size={14} />
        </button>
        <button type="button" title="New folder" aria-label="New folder" onClick={() => setCreating("dir")} className="p-1 rounded hover:text-fg hover:bg-bg-hover cursor-pointer">
          <FolderPlus size={14} />
        </button>
        <button type="button" title="Refresh" aria-label="Refresh files" onClick={refresh} className="p-1 rounded hover:text-fg hover:bg-bg-hover cursor-pointer">
          <RefreshCw size={14} />
        </button>
      </div>
      {creating && (
        <div className="px-2 py-1.5 border-b border-border">
          <input
            autoFocus
            aria-label={creating === "dir" ? "New folder path" : "New file path"}
            className="input"
            placeholder={creating === "dir" ? "folder/name" : "contracts/hello.sil"}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void confirmCreate();
              if (e.key === "Escape") setCreating(null);
            }}
          />
        </div>
      )}
      <div role="tree" aria-label="Workspace files" className="py-1">
        {tree.length === 0 && (
          <div className="px-3 py-4 text-center space-y-2 text-fg-muted">
            <div>Empty workspace.</div>
            <button type="button" className="btn-ghost w-full justify-center" onClick={() => setCreating("file")}>
              <FilePlus2 size={13} /> New file
            </button>
          </div>
        )}
        {/* The project's own files first; dot-folders such as .hardkas (HardKas runtime state) go last, collapsed. */}
        {sortProjectFirst(tree).map((node) => (
          <Node key={node.path} node={node} depth={0} onMenu={(x, y, n) => setMenu({ x, y, node: n })} />
        ))}
      </div>
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
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

function Node({ node, depth, onMenu }: { node: TreeNode; depth: number; onMenu: (x: number, y: number, n: TreeNode) => void }) {
  const engine = useEngine();
  const activeFile = useIde((s) => s.activeFile);
  const internal = isInternal(node);
  const [open, setOpen] = useState(depth < 1 && !internal);
  const isDir = node.type === "dir";
  const isActive = node.path === activeFile;

  const onActivate = () => {
    if (isDir) setOpen((o) => !o);
    else void engine.call("fileManager", "open", node.path);
  };

  const Icon = isDir ? (open ? FolderOpen : Folder) : node.name.endsWith(".sil") || node.name.endsWith(".ts") ? FileCode2 : File;

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
          onMenu(e.clientX, e.clientY, node);
        }}
        className={clsx(
          "group flex items-center gap-1 pr-2 py-0.5 cursor-pointer hover:bg-bg-hover outline-none",
          isActive && "bg-bg-hover text-accent font-medium",
          internal && "opacity-60"
        )}
        style={{ paddingLeft: 8 + depth * 12 }}
        title={internal && depth === 0 ? `${node.path} (HardKas runtime state: artifacts, accounts, node data)` : node.path}
      >
        <span className="w-3 text-fg-muted shrink-0">{isDir ? open ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : null}</span>
        <Icon size={14} className={clsx("shrink-0", isDir ? (internal ? "text-fg-muted" : "text-warn") : node.name.endsWith(".sil") ? "text-accent" : "text-fg-muted")} />
        <span className="truncate flex-1">{node.name}</span>
        {internal && depth === 0 && isDir && <span className="text-[10px] text-fg-muted shrink-0">state</span>}
      </div>
      {isDir && open && (
        <div role="group">
          {sortProjectFirst(node.children ?? []).map((child) => (
            <Node key={child.path} node={child} depth={depth + 1} onMenu={onMenu} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Right-click menu. Like Remix, entries depend on the file extension (.sil gets the SilverScript actions). */
function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const engine = useEngine();
  const n = menu.node;
  const isSil = n.type === "file" && n.name.endsWith(".sil");
  const isDeploy = n.type === "file" && /silverDeploy-.*\.json$/.test(n.name);
  const fm = (method: string, ...args: unknown[]) => void engine.call("fileManager", method, ...args);

  const compile = async (thenDeploy: boolean) => {
    await engine.call("fileManager", "open", n.path);
    const result = await engine.get<CompilerPlugin>("silverCompiler").compile(n.path);
    if (thenDeploy && result.ok) useIde.getState().setActiveSidePlugin("deployRun");
  };

  const items: Array<{ label: string; icon: React.ReactNode; run: () => void; danger?: boolean } | "sep"> = [];
  if (n.type === "file") items.push({ label: "Open", icon: <File size={13} />, run: () => fm("open", n.path) });
  if (isSil) {
    items.push({ label: "Compile SilverScript", icon: <Hammer size={13} />, run: () => void compile(false) });
    items.push({ label: "Compile & Deploy…", icon: <Rocket size={13} />, run: () => void compile(true) });
  }
  if (n.type === "file" && /\.(test|spec)\.[cm]?[jt]sx?$/.test(n.name)) {
    items.push({ label: "Run tests in this file", icon: <Hammer size={13} />, run: () => void engine.call("tests", "runFile", n.path) });
  }
  if (isDeploy) {
    items.push({
      label: "Load as deployed contract",
      icon: <PackageOpen size={13} />,
      run: () => {
        void engine.get<SilverPlugin>("silverContracts").loadDeployRecord(n.path);
        useIde.getState().setActiveSidePlugin("deployRun");
      }
    });
  }
  if (items.length > 0) items.push("sep");
  items.push({ label: "Copy path", icon: <Copy size={13} />, run: () => void navigator.clipboard.writeText(n.path) });
  items.push({
    label: "Rename…",
    icon: <Pencil size={13} />,
    run: () => {
      const to = prompt(`Rename ${n.path} to:`, n.path);
      if (to && to !== n.path) fm("rename", n.path, to);
    }
  });
  items.push({
    label: "Delete",
    icon: <Trash2 size={13} />,
    danger: true,
    run: () => {
      if (confirm(`Delete ${n.path}?`)) fm("remove", n.path);
    }
  });

  const x = Math.min(menu.x, window.innerWidth - 230);
  const y = Math.min(menu.y, window.innerHeight - 40 * items.length);
  return (
    <ul role="menu" aria-label={`Actions for ${n.name}`} className="fixed z-50 w-56 rounded border border-border bg-bg-elev shadow-2xl py-1 text-xs" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
      {items.map((it, i) =>
        it === "sep" ? (
          <li key={i} role="separator" className="my-1 border-t border-border" />
        ) : (
          <li key={i} role="none">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onClose();
                it.run();
              }}
              className={clsx("w-full text-left px-3 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-bg-hover", it.danger ? "text-error" : "text-fg")}
            >
              {it.icon} {it.label}
            </button>
          </li>
        )
      )}
    </ul>
  );
}
