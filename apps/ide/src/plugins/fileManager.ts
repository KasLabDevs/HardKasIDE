import { api } from "@/api/client";
import { Plugin } from "@/engine/engine";
import { languageForPath, useIde } from "@/store/ide";

/**
 * File manager service: the only plugin that touches the workspace file system.
 * Everyone else calls it (single owner of the file system).
 */
export class FileManagerPlugin extends Plugin {
  constructor() {
    super({
      name: "fileManager",
      displayName: "File manager",
      location: "none",
      methods: ["refresh", "readFile", "writeFile", "open", "saveFile", "saveCurrentFile", "getCurrentFile", "mkdir", "remove", "rename", "createFile"],
      events: ["currentFileChanged", "fileSaved", "treeChanged", "fileAdded", "fileRemoved"]
    });
  }

  async onActivation(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const state = useIde.getState();
    if (!state.workspace?.root) {
      state.setTree([]);
      return;
    }
    const { tree } = await api.fs.tree();
    state.setTree(tree);
    this.emit("treeChanged", tree);
  }

  readFile(path: string): Promise<string> {
    return api.fs.read(path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    await api.fs.write(path, content);
    this.emit("fileSaved", path);
  }

  async open(path: string): Promise<void> {
    const state = useIde.getState();
    const already = state.openFiles.find((f) => f.path === path);
    if (already) {
      state.setActiveFile(path);
    } else {
      const content = await api.fs.read(path);
      state.upsertOpenFile({ path, content, savedContent: content, language: languageForPath(path) });
    }
    this.emit("currentFileChanged", path);
  }

  getCurrentFile(): string | null {
    return useIde.getState().activeFile;
  }

  async saveFile(path: string): Promise<void> {
    const state = useIde.getState();
    const file = state.openFiles.find((f) => f.path === path);
    if (!file || file.kind === "view") return;
    await api.fs.write(path, file.content);
    state.markSaved(path);
    state.setStatus(`Saved ${path}`);
    this.emit("fileSaved", path);
  }

  async saveCurrentFile(): Promise<void> {
    const current = this.getCurrentFile();
    if (current && !current.startsWith("view:")) await this.saveFile(current);
  }

  async createFile(path: string, content = ""): Promise<void> {
    await api.fs.write(path, content);
    await this.refresh();
    this.emit("fileAdded", path);
    await this.open(path);
  }

  async mkdir(path: string): Promise<void> {
    await api.fs.mkdir(path);
    await this.refresh();
  }

  async remove(path: string): Promise<void> {
    await api.fs.remove(path);
    const state = useIde.getState();
    for (const f of state.openFiles) {
      if (f.path === path || f.path.startsWith(path + "/")) state.closeFile(f.path);
    }
    await this.refresh();
    this.emit("fileRemoved", path);
  }

  async rename(from: string, to: string): Promise<void> {
    await api.fs.rename(from, to);
    const state = useIde.getState();
    const prefix = from + "/";
    const affected = state.openFiles.filter((f) => f.path === from || f.path.startsWith(prefix));
    if (affected.length > 0) {
      const nextFiles = state.openFiles.map((f) => {
        if (f.path === from) return { ...f, path: to, language: languageForPath(to) };
        if (f.path.startsWith(prefix)) {
          const nextPath = to + "/" + f.path.slice(prefix.length);
          return { ...f, path: nextPath, language: languageForPath(nextPath) };
        }
        return f;
      });
      const activeFile =
        state.activeFile === from
          ? to
          : state.activeFile?.startsWith(prefix)
            ? to + "/" + state.activeFile.slice(prefix.length)
            : state.activeFile;
      useIde.setState({ openFiles: nextFiles, activeFile });
    }
    await this.refresh();
  }
}
