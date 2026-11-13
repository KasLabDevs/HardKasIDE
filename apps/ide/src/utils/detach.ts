import { VIEW_PREFIX, type OpenFile } from "@/store/ide";

const DETACH_CHANNEL = "hardkas-ide.detach";
const DETACH_BUFFER_PREFIX = "hardkas-ide.detach.buffer:";

export type DetachTarget =
  | { kind: "file"; path: string }
  | { kind: "view"; pluginName: string; title: string };

export type DetachMessage =
  | { type: "reattach-file"; path: string; content: string; savedContent: string; language: string }
  | { type: "reattach-view"; pluginName: string; title: string }
  | { type: "file-saved"; path: string; content: string };

interface DetachedFileSnapshot {
  content: string;
  savedContent: string;
  language: string;
}

/** Parses `?detachFile=...` or `?detachView=...` from the current URL query string. */
export function parseDetachQuery(search: string = typeof window !== "undefined" ? window.location.search : ""): DetachTarget | null {
  if (!search) return null;
  const params = new URLSearchParams(search);
  const detachFile = params.get("detachFile")?.trim();
  if (detachFile) return { kind: "file", path: detachFile };
  const detachView = params.get("detachView")?.trim();
  if (detachView) {
    return {
      kind: "view",
      pluginName: detachView,
      title: params.get("detachTitle")?.trim() || detachView
    };
  }
  return null;
}

export function stashDetachedFile(file: Pick<OpenFile, "path" | "content" | "savedContent" | "language">): void {
  try {
    const payload: DetachedFileSnapshot = {
      content: file.content,
      savedContent: file.savedContent,
      language: file.language
    };
    localStorage.setItem(DETACH_BUFFER_PREFIX + file.path, JSON.stringify(payload));
  } catch {
    // Storage full or unavailable; detached window will fall back to loading from disk.
  }
}

export function consumeDetachedFile(path: string): DetachedFileSnapshot | null {
  try {
    const raw = localStorage.getItem(DETACH_BUFFER_PREFIX + path);
    if (!raw) return null;
    localStorage.removeItem(DETACH_BUFFER_PREFIX + path);
    const parsed = JSON.parse(raw) as Partial<DetachedFileSnapshot>;
    if (typeof parsed.content === "string" && typeof parsed.savedContent === "string" && typeof parsed.language === "string") {
      return { content: parsed.content, savedContent: parsed.savedContent, language: parsed.language };
    }
  } catch {
    // Ignore malformed snapshot.
  }
  return null;
}

/** Opens a tab (file or plugin view) in a standalone detached window. Must be invoked synchronously from a user gesture. */
export function openDetachedWindow(file: OpenFile): boolean {
  if (typeof window === "undefined") return false;
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  if (file.kind === "view") {
    const pluginName = file.path.slice(VIEW_PREFIX.length);
    url.searchParams.set("detachView", pluginName);
    if (file.title) url.searchParams.set("detachTitle", file.title);
  } else {
    stashDetachedFile(file);
    url.searchParams.set("detachFile", file.path);
  }
  const win = window.open(
    url.toString(),
    `hardkas-detach-${Date.now()}`,
    "popup=yes,width=1100,height=740,resizable=yes,scrollbars=yes"
  );
  return Boolean(win);
}

export function postDetachMessage(message: DetachMessage): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(DETACH_CHANNEL);
    channel.postMessage(message);
    channel.close();
  } catch {
    // Ignore environments without BroadcastChannel support.
  }
}

export function subscribeDetachMessages(handler: (message: DetachMessage) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  try {
    const channel = new BroadcastChannel(DETACH_CHANNEL);
    channel.onmessage = (event) => {
      if (event?.data && typeof event.data === "object" && "type" in event.data) {
        handler(event.data as DetachMessage);
      }
    };
    return () => channel.close();
  } catch {
    return () => {};
  }
}
