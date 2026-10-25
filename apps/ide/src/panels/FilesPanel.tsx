import clsx from "clsx";
import { ChevronDown, ChevronRight, File, FileCode2, FilePlus2, Folder, FolderOpen, FolderPlus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import type { TreeNode } from "@/api/client";
import { useEngine } from "@/engine/context";
import { useIde } from "@/store/ide";

export function FilesPanel() {
  const engine = useEngine();
  const tree = useIde((s) => s.tree);
  const workspace = useIde((s) => s.workspace);
  const [creating, setCreating] = useState<"file" | "dir" | null>(null);
  const [newName, setNewName] = useState("");

  const refresh = () => void engine.call("fileManager", "refresh");

  const confirmCreate = async () => {
    const name = newName.trim();
    setCreating(null);
    setNewName("");
    if (!name) return;
    if (creating === "dir") await engine.call("fileManager", "mkdir", name);
    else await engine.call("fileManager", "createFile", name, name.endsWith(".sil") ? "pragma silverscript ^0.1.0;\n\ncontract Hello(pubkey owner) {\n  entry spend(sig s) {\n    require(checkSig(s, owner));\n  }\n}\n" : "");
  };

  return (
    <div className="text-xs select-none">
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border text-fg-muted">
        <span className="truncate flex-1 font-medium text-fg" title={workspace?.root ?? ""}>
          {workspace?.name ?? "—"}
        </span>
        <button title="New file" onClick={() => setCreating("file")} className="p-1 hover:text-fg">
          <FilePlus2 size={14} />
        </button>
        <button title="New folder" onClick={() => setCreating("dir")} className="p-1 hover:text-fg">
          <FolderPlus size={14} />
        </button>
        <button title="Refresh" onClick={refresh} className="p-1 hover:text-fg">
          <RefreshCw size={14} />
        </button>
      </div>
      {creating && (
        <div className="px-2 py-1.5 border-b border-border">
          <input
            autoFocus
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
      <div className="py-1">
        {tree.length === 0 && <div className="px-3 py-2 text-fg-muted">Empty workspace.</div>}
        {tree.map((node) => (
          <Node key={node.path} node={node} depth={0} />
        ))}
      </div>
    </div>
  );
}

function Node({ node, depth }: { node: TreeNode; depth: number }) {
  const engine = useEngine();
  const activeFile = useIde((s) => s.activeFile);
  const [open, setOpen] = useState(depth < 1);
  const isDir = node.type === "dir";
  const isActive = node.path === activeFile;

  const onClick = () => {
    if (isDir) setOpen((o) => !o);
    else void engine.call("fileManager", "open", node.path);
  };
  const onDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Delete ${node.path}?`)) void engine.call("fileManager", "remove", node.path);
  };

  const Icon = isDir ? (open ? FolderOpen : Folder) : node.name.endsWith(".sil") || node.name.endsWith(".ts") ? FileCode2 : File;

  return (
    <div>
      <div
        onClick={onClick}
        className={clsx("group flex items-center gap-1 pr-2 py-0.5 cursor-pointer hover:bg-bg-hover", isActive && "bg-bg-hover text-accent")}
        style={{ paddingLeft: 8 + depth * 12 }}
        title={node.path}
      >
        <span className="w-3 text-fg-muted">{isDir ? open ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : null}</span>
        <Icon size={14} className={clsx(isDir ? "text-warn" : node.name.endsWith(".sil") ? "text-accent" : "text-fg-muted")} />
        <span className="truncate flex-1">{node.name}</span>
        <button onClick={onDelete} className="opacity-0 group-hover:opacity-100 text-fg-muted hover:text-error" title="Delete">
          <Trash2 size={12} />
        </button>
      </div>
      {isDir && open && node.children?.map((child) => <Node key={child.path} node={child} depth={depth + 1} />)}
    </div>
  );
}
