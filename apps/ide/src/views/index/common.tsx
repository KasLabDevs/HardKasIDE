import clsx from "clsx";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { shortKind } from "@/store/indexStore";
import { useIde } from "@/store/ide";
import { copyText } from "@/utils/clipboard";
import { SCHEMA_STYLE } from "../lineageStyle";

export function KindChip({ schema }: { schema: string | null | undefined }) {
  const k = shortKind(schema);
  const style = SCHEMA_STYLE[k] ?? { color: "var(--fg-muted)", label: k };
  return (
    <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold border whitespace-nowrap" style={{ color: style.color, borderColor: `color-mix(in srgb, ${style.color} 45%, transparent)`, background: `color-mix(in srgb, ${style.color} 12%, transparent)` }}>
      {style.label === k ? k : style.label}
    </span>
  );
}

export function fmtBytes(n: number | undefined): string {
  if (n === undefined) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const when = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString(undefined, { hour12: false, month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";

export const shorten = (s: string | null | undefined, head = 12, tail = 0): string => {
  if (!s) return "—";
  return s.length <= head + tail + 1 ? s : tail ? `${s.slice(0, head)}…${s.slice(-tail)}` : `${s.slice(0, head)}…`;
};

/** Absolute path from the index → path relative to the open project, for the file manager. */
export function useRelativePath(): (p: string | null | undefined) => string | null {
  const root = useIde((s) => s.workspace?.root ?? "");
  return (p) => {
    if (!p) return null;
    const norm = p.replace(/\\/g, "/");
    const base = root.replace(/\\/g, "/").replace(/\/$/, "");
    return base && norm.toLowerCase().startsWith(`${base.toLowerCase()}/`) ? norm.slice(base.length + 1) : norm;
  };
}

export function CopyBtn({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className="p-0.5 rounded text-fg-muted hover:text-accent hover:bg-bg-hover cursor-pointer shrink-0"
      onClick={() =>
        void copyText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        })
      }
    >
      {done ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
    </button>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "warn" | "ok" }) {
  return (
    <div className="rounded border border-border bg-bg-elev px-3 py-2 min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-fg-muted">{label}</div>
      <div className={clsx("text-base font-semibold tabular-nums mt-0.5 truncate", tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "text-fg")}>{value}</div>
      {sub && <div className="text-[10px] text-fg-muted truncate">{sub}</div>}
    </div>
  );
}

/** Horizontal bars for a breakdown; clicking one filters by it. */
export function Bars({ title, items, onPick, label }: { title: string; items: Array<{ name: string; count: number }>; onPick?: (name: string) => void; label?: (name: string) => React.ReactNode }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="rounded border border-border bg-bg-elev p-3 space-y-1.5 min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-fg-muted">{title}</div>
      {items.length === 0 && <div className="text-fg-muted">Nothing indexed yet.</div>}
      {items.map((i) => (
        <button
          key={i.name}
          type="button"
          disabled={!onPick}
          onClick={() => onPick?.(i.name)}
          className={clsx("w-full flex items-center gap-2 text-left rounded px-1 py-0.5", onPick ? "hover:bg-bg-hover cursor-pointer" : "cursor-default")}
          title={onPick ? `Show these in the Artifacts tab` : undefined}
        >
          <span className="w-32 shrink-0 truncate">{label ? label(i.name) : i.name}</span>
          <span className="flex-1 h-2 rounded bg-bg-hover overflow-hidden">
            <span className="block h-full bg-accent/70" style={{ width: `${(i.count / max) * 100}%` }} />
          </span>
          <span className="w-10 text-right tabular-nums text-fg-muted shrink-0">{i.count}</span>
        </button>
      ))}
    </div>
  );
}
