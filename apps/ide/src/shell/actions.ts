import { api } from "@/api/client";
import type { Engine } from "@/engine/engine";
import type { EditorPlugin } from "@/plugins/editor";
import type { EnvironmentPlugin } from "@/plugins/environment";
import { useIde } from "@/store/ide";
import { confirmDialog, promptDialog } from "@/utils/dialog";
import { openNewArtifactWizard } from "./NewArtifactDialog";

/** Small actions shared by the title-bar menus, the command palette and the keyboard shortcuts. */

export const PALETTE_EVENT = "hardkas:palette";

export function openPalette(initialQuery?: unknown): void {
  const seed = typeof initialQuery === "string" ? initialQuery : undefined;
  window.dispatchEvent(new CustomEvent(PALETTE_EVENT, { detail: { initialQuery: seed } }));
}

export function isTextFile(path: string | null | undefined): path is string {
  return !!path && !path.startsWith("view:");
}

export function isDirty(path: string): boolean {
  const f = useIde.getState().openFiles.find((x) => x.path === path);
  return !!f && f.kind !== "view" && f.content !== f.savedContent;
}

/** Closes an editor tab, asking first when it has unsaved changes. */
export async function closeEditor(path: string): Promise<void> {
  if (isDirty(path) && !(await confirmDialog(`${path} has unsaved changes. Close it and discard them?`, { title: "Unsaved changes", confirmLabel: "Discard and close", danger: true }))) return;
  useIde.getState().closeFile(path);
}

export async function closeAllEditors(): Promise<void> {
  const dirty = useIde.getState().openFiles.filter((f) => f.kind !== "view" && f.content !== f.savedContent);
  if (dirty.length > 0 && !(await confirmDialog(`${dirty.length} file(s) have unsaved changes. Close all editors and discard them?`, { title: "Unsaved changes", confirmLabel: "Discard all", danger: true }))) return;
  for (const f of [...useIde.getState().openFiles]) useIde.getState().closeFile(f.path);
}

export async function saveAll(engine: Engine): Promise<void> {
  for (const f of useIde.getState().openFiles) {
    if (f.kind !== "view" && f.content !== f.savedContent) await engine.call("fileManager", "saveFile", f.path);
  }
}

export async function saveAs(engine: Engine): Promise<void> {
  const s = useIde.getState();
  const active = s.activeFile;
  if (!isTextFile(active)) return;
  const openFile = s.openFiles.find((f) => f.path === active);
  if (!openFile) return;

  const targetPath = await promptDialog("Enter the new relative path for this file:", active, {
    title: "Save As",
    confirmLabel: "Save As"
  });
  if (!targetPath || !targetPath.trim()) return;
  const clean = targetPath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  await engine.call("fileManager", "writeFile", clean, openFile.content);
  await engine.call("fileManager", "refresh");
  await engine.call("fileManager", "open", clean);
  s.setStatus(`Saved as ${clean}`);
}

export async function revertActiveFile(): Promise<void> {
  const s = useIde.getState();
  const active = s.activeFile;
  if (!isTextFile(active) || !isDirty(active)) return;
  const openFile = s.openFiles.find((f) => f.path === active);
  if (!openFile) return;
  const ok = await confirmDialog(`Revert all unsaved changes in '${active}' back to the last saved version on disk?`, {
    title: "Revert File",
    confirmLabel: "Revert",
    danger: true
  });
  if (!ok) return;
  s.updateContent(active, openFile.savedContent);
  s.setStatus(`Reverted ${active}`);
}

export async function renameActiveFile(engine: Engine): Promise<void> {
  const s = useIde.getState();
  const active = s.activeFile;
  if (!isTextFile(active)) return;
  const nextPath = await promptDialog("Rename file to:", active, {
    title: "Rename Resource",
    confirmLabel: "Rename"
  });
  if (!nextPath || !nextPath.trim() || nextPath.trim() === active) return;
  const clean = nextPath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  await api.fs.rename(active, clean);
  s.closeFile(active);
  await engine.call("fileManager", "refresh");
  await engine.call("fileManager", "open", clean);
  s.setStatus(`Renamed ${active} → ${clean}`);
}

export async function moveActiveFile(engine: Engine): Promise<void> {
  const s = useIde.getState();
  const active = s.activeFile;
  if (!isTextFile(active)) return;
  const parts = active.split("/");
  const fileName = parts.pop() || active;
  const currentDir = parts.join("/");
  const targetDir = await promptDialog(`Move '${fileName}' to destination folder:`, currentDir || "contracts", {
    title: "Move Resource",
    confirmLabel: "Move"
  });
  if (targetDir === null) return;
  const cleanDir = targetDir.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const destPath = cleanDir ? `${cleanDir}/${fileName}` : fileName;
  if (destPath === active) return;
  await api.fs.rename(active, destPath);
  s.closeFile(active);
  await engine.call("fileManager", "refresh");
  await engine.call("fileManager", "open", destPath);
  s.setStatus(`Moved ${active} → ${destPath}`);
}

export async function convertLineDelimiters(engine: Engine, mode: "LF" | "CRLF"): Promise<void> {
  const s = useIde.getState();
  const active = s.activeFile;
  if (!isTextFile(active)) return;
  const openFile = s.openFiles.find((f) => f.path === active);
  if (!openFile) return;
  const normalizedLf = openFile.content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const converted = mode === "CRLF" ? normalizedLf.replace(/\n/g, "\r\n") : normalizedLf;
  s.updateContent(active, converted);
  await engine.call("fileManager", "saveFile", active);
  s.setStatus(`Converted line delimiters of ${active} to ${mode}`);
}

export function importExternalFile(engine: Engine): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".sil,.ts,.tsx,.js,.json,.md,.sql,.toml,.yaml,.yml";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    const defaultFolder = file.name.endsWith(".sil") ? "contracts" : file.name.endsWith(".test.ts") ? "test" : "scripts";
    const dest = await promptDialog(`Import '${file.name}' into workspace path:`, `${defaultFolder}/${file.name}`, {
      title: "Import File into Workspace",
      confirmLabel: "Import"
    });
    if (!dest || !dest.trim()) return;
    const clean = dest.trim().replace(/\\/g, "/").replace(/^\/+/, "");
    await engine.call("fileManager", "writeFile", clean, text);
    await engine.call("fileManager", "refresh");
    await engine.call("fileManager", "open", clean);
    useIde.getState().setStatus(`Imported ${clean}`);
  };
  input.click();
}

export function exportActiveFile(): void {
  const s = useIde.getState();
  const active = s.activeFile;
  if (!isTextFile(active)) return;
  const openFile = s.openFiles.find((f) => f.path === active);
  if (!openFile) return;
  const blob = new Blob([openFile.content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = active.split("/").pop() || "exported-file.txt";
  a.click();
  URL.revokeObjectURL(url);
  s.setStatus(`Exported ${active}`);
}

export async function newFile(_engine?: Engine, templateId?: string, folder?: string): Promise<void> {
  openNewArtifactWizard({ templateId, folder });
}

export function editorCommand(engine: Engine, commandId: string): void {
  engine.get<EditorPlugin>("editor").trigger(commandId);
}

export function zoomBy(delta: number): void {
  const ide = useIde.getState();
  ide.setZoom(ide.zoom + delta);
}

/** The one destructive node operation: always behind an explicit confirmation. */
export async function confirmAndResetNode(engine: Engine): Promise<void> {
  if (await confirmDialog("Reset the local node from scratch?\n\nThis DELETES the whole local chain (deployed contracts and previous history disappear), then recreates and seeds the dev accounts (100 KAS each from localnet Treasury, waiting for confirmed balances). Account keys are not deleted: the simnet dev keystores (.hardkas/dev-accounts) are moved to .hardkas/backups/reset-<time>/, and .hardkas/accounts.real.json stays where it is (a copy goes to the same backup), so testnet accounts keep working. Artifacts and your files are kept.", { title: "Reset local node", confirmLabel: "Reset from scratch", danger: true })) {
    await engine.get<EnvironmentPlugin>("environment").resetNode();
  }
}
