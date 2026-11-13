import clsx from "clsx";
import { AlertTriangle, HelpCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useDialogs } from "@/utils/dialog";

/** Renders the in-app confirm/prompt dialogs (one at a time, queued). Mounted once at the root of the app. */
export function DialogHost() {
  const current = useDialogs((s) => s.queue[0]);
  const settle = useDialogs((s) => s.settle);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!current) return;
    setValue(current.defaultValue ?? "");
    const t = setTimeout(() => {
      if (current.kind === "prompt") {
        inputRef.current?.focus();
        inputRef.current?.select();
      } else confirmRef.current?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [current]);

  if (!current) return null;

  const cancel = () => settle(current.id, current.kind === "prompt" ? null : false);
  const accept = () => {
    if (current.kind === "prompt") {
      const v = value.trim();
      settle(current.id, v ? v : null);
    } else settle(current.id, true);
  };
  const [first, ...rest] = current.message.split("\n\n");
  const Icon = current.danger ? AlertTriangle : HelpCircle;

  return (
    <div
      className="fixed inset-0 z-[1000] grid place-items-center bg-black/50 backdrop-blur-[1px]"
      onMouseDown={(e) => e.target === e.currentTarget && cancel()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        } else if (e.key === "Enter" && current.kind === "prompt") {
          e.preventDefault();
          accept();
        }
      }}
    >
      <div role="alertdialog" aria-modal="true" aria-labelledby="ide-dialog-title" className="w-[420px] max-w-[92vw] rounded-md border border-border bg-bg-panel shadow-2xl text-xs">
        <div className="flex items-start gap-3 p-4">
          <Icon size={18} className={clsx("shrink-0 mt-0.5", current.danger ? "text-error" : "text-accent")} />
          <div className="min-w-0 flex-1 space-y-2">
            <div id="ide-dialog-title" className="text-sm font-semibold text-fg">
              {current.title ?? (current.kind === "prompt" ? first : "HardKas IDE")}
            </div>
            {(current.title || current.kind === "confirm") && <p className="text-fg whitespace-pre-wrap break-words">{first}</p>}
            {rest.map((p, i) => (
              <p key={i} className="text-fg-muted whitespace-pre-wrap break-words">
                {p}
              </p>
            ))}
            {current.kind === "prompt" && (
              <input ref={inputRef} aria-label={first} className="input font-mono" value={value} onChange={(e) => setValue(e.target.value)} spellCheck={false} />
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border bg-bg/40 rounded-b-md">
          <button type="button" className="btn-ghost" onClick={cancel}>
            {current.cancelLabel ?? "Cancel"}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={clsx("btn-primary", current.danger && "!bg-error hover:!bg-error/90 !text-white")}
            onClick={accept}
            disabled={current.kind === "prompt" && !value.trim()}
          >
            {current.confirmLabel ?? (current.kind === "prompt" ? "OK" : "Confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
