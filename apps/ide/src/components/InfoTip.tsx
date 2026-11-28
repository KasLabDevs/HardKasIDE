import clsx from "clsx";
import { Info } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface InfoTipProps {
  label: string;
  children: ReactNode;
  className?: string;
}

/**
 * Compact ⓘ trigger that reveals longer explanatory copy on hover or click inside a viewport-clamped portal popover.
 * Keeps narrow sidebars focused on live controls while keeping full technical guidance one glance away.
 */
export function InfoTip({ label, children, className }: InfoTipProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean }>({ top: 0, left: 8, above: false });

  const clearTimer = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 264;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left - width / 2 + rect.width / 2));
    const above = rect.bottom + 170 > window.innerHeight && rect.top > 180;
    const top = above ? rect.top - 6 : rect.bottom + 6;
    setPos({ top, left, above });
  };

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !popoverRef.current?.contains(target)) {
        setOpen(false);
        setPinned(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setPinned(false);
      }
    };
    const onReflow = () => updatePosition();
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      clearTimer();
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open]);

  const onEnter = () => {
    clearTimer();
    updatePosition();
    setOpen(true);
  };

  const onLeave = () => {
    if (pinned) return;
    clearTimer();
    closeTimerRef.current = setTimeout(() => setOpen(false), 160);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          const next = !(open && pinned);
          setPinned(next);
          if (next) updatePosition();
          setOpen(next);
        }}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        className={clsx(
          "inline-flex items-center justify-center rounded p-0.5 transition-colors cursor-pointer shrink-0",
          open ? "text-accent bg-accent/10" : "text-fg-muted hover:text-accent hover:bg-bg-hover",
          className
        )}
      >
        <Info size={13} />
      </button>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            role="tooltip"
            onMouseEnter={onEnter}
            onMouseLeave={onLeave}
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              width: 264,
              transform: pos.above ? "translateY(-100%)" : undefined
            }}
            className="z-50 rounded-md border border-border bg-bg-elev p-2.5 text-[11.5px] leading-relaxed text-fg-muted shadow-2xl space-y-1.5"
          >
            {children}
          </div>,
          document.body
        )}
    </>
  );
}
