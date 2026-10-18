"use client";
// Small shared UI primitives: buttons, chips, accordion, spinner, stat tile.
import { useEffect, useId, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { IconChevronDown } from "./Icons";

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
        variant === "primary" && "bg-accent text-accent-fg hover:bg-accent-hover",
        variant === "secondary" && "border border-line-strong bg-surface text-fg hover:border-accent hover:text-accent",
        variant === "ghost" && "text-muted hover:bg-surface-2 hover:text-fg",
        variant === "danger" && "border border-line-strong bg-surface text-danger hover:border-danger",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Chip({
  children,
  tone = "neutral",
  className,
  title,
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "ok" | "warn" | "danger";
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap",
        tone === "neutral" && "bg-surface-2 text-muted",
        tone === "accent" && "bg-accent-faint text-accent",
        tone === "ok" && "bg-ok-soft text-ok",
        tone === "warn" && "bg-warn-soft text-warn",
        tone === "danger" && "bg-danger-soft text-danger",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg className={cx("animate-spin", className)} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Accordion({
  title,
  count,
  defaultOpen = false,
  children,
  right,
  anchor,
}: {
  title: string;
  count?: number | string;
  defaultOpen?: boolean;
  children: ReactNode;
  right?: ReactNode;
  /** section id; the accordion opens itself when the URL hash points at it */
  anchor?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  useEffect(() => {
    if (!anchor) return;
    const check = () => {
      if (window.location.hash === `#${anchor}`) setOpen(true);
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, [anchor]);
  return (
    <section id={anchor} className="scroll-mt-20 border-b border-line">
      <h3 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2 px-1 py-3.5 text-left text-[17px] font-medium text-fg hover:text-accent"
        >
          <span className="flex-1">
            {title}
            {count !== undefined && <span className="ml-1 font-normal text-muted">({count})</span>}
          </span>
          {right}
          <IconChevronDown size={18} className={cx("transition-transform", open && "rotate-180")} />
        </button>
      </h3>
      <div id={id} hidden={!open} className="pb-4">
        {open && children}
      </div>
    </section>
  );
}

export function StatTile({ label, value, sub, accent }: { label: string; value: ReactNode; sub?: ReactNode; accent?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-surface px-3.5 py-2.5">
      <div className="text-[11px] font-medium tracking-wide text-muted uppercase">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        {accent && <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: accent }} />}
        <span className="text-xl font-semibold text-fg tabular-nums">{value}</span>
      </div>
      {sub && <div className="mt-0.5 truncate text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line-strong bg-surface-2 px-1 font-mono text-[10px] text-muted">{children}</kbd>;
}
