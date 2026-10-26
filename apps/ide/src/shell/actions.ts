import type { Engine } from "@/engine/engine";
import type { EditorPlugin } from "@/plugins/editor";
import type { EnvironmentPlugin } from "@/plugins/environment";
import { useIde } from "@/store/ide";

/** Small actions shared by the title-bar menus, the command palette and the keyboard shortcuts. */

export const PALETTE_EVENT = "hardkas:palette";

export function openPalette(): void {
  window.dispatchEvent(new Event(PALETTE_EVENT));
}

export function isTextFile(path: string | null | undefined): path is string {
  return !!path && !path.startsWith("view:");
}

export function isDirty(path: string): boolean {
  const f = useIde.getState().openFiles.find((x) => x.path === path);
  return !!f && f.kind !== "view" && f.content !== f.savedContent;
}

/** Closes an editor tab, asking first when it has unsaved changes. */
export function closeEditor(path: string): void {
  if (isDirty(path) && !window.confirm(`${path} has unsaved changes. Close it and discard them?`)) return;
  useIde.getState().closeFile(path);
}

export function closeAllEditors(): void {
  const dirty = useIde.getState().openFiles.filter((f) => f.kind !== "view" && f.content !== f.savedContent);
  if (dirty.length > 0 && !window.confirm(`${dirty.length} file(s) have unsaved changes. Close all editors and discard them?`)) return;
  for (const f of [...useIde.getState().openFiles]) useIde.getState().closeFile(f.path);
}

export async function saveAll(engine: Engine): Promise<void> {
  for (const f of useIde.getState().openFiles) {
    if (f.kind !== "view" && f.content !== f.savedContent) await engine.call("fileManager", "saveFile", f.path);
  }
}

export async function newFile(engine: Engine): Promise<void> {
  const name = window.prompt("New file (path relative to the project, e.g. contracts/vault.sil):", "contracts/new.sil")?.trim();
  if (!name) return;
  await engine.call("fileManager", "createFile", name);
}

export function editorCommand(engine: Engine, commandId: string): void {
  engine.get<EditorPlugin>("editor").trigger(commandId);
}

export function zoomBy(delta: number): void {
  const ide = useIde.getState();
  ide.setZoom(ide.zoom + delta);
}

/** The one destructive node operation: always behind an explicit confirmation. */
export function confirmAndResetNode(engine: Engine): Promise<void> | void {
  if (window.confirm("Reset the local node from scratch?\n\nThis DELETES the whole local chain: balances go back to zero and deployed contracts disappear. Artifacts and your files are kept.")) {
    return engine.get<EnvironmentPlugin>("environment").resetNode();
  }
}
