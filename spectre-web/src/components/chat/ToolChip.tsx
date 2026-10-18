"use client";
import { useState } from "react";
import type { ChatToolCall } from "@/lib/client/store";
import { humanizeTool } from "@/lib/client/derive";
import { IconAlert, IconBolt, IconCheck, IconChevronDown } from "@/components/ui/Icons";
import { cx, Spinner } from "@/components/ui/primitives";

export function ToolChip({ call }: { call: ChatToolCall }) {
  const [open, setOpen] = useState(false);
  const input = call.input && typeof call.input === "object" && Object.keys(call.input as object).length ? JSON.stringify(call.input, null, 1) : "";
  return (
    <div className="my-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cx(
          "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition-colors",
          call.status === "running" && "border-accent/40 bg-accent-faint text-accent",
          call.status === "ok" && "border-line bg-surface-2 text-fg hover:border-line-strong",
          call.status === "error" && "border-danger/40 bg-danger-soft text-danger",
        )}
      >
        {call.status === "running" ? (
          <Spinner size={11} />
        ) : call.status === "ok" ? (
          <IconCheck size={12} className="text-ok" />
        ) : (
          <IconAlert size={12} />
        )}
        <IconBolt size={11} className="opacity-60" />
        <span className="font-medium">{humanizeTool(call.name)}</span>
        {call.summary && <span className="min-w-0 truncate text-muted">· {call.summary}</span>}
        <IconChevronDown size={12} className={cx("shrink-0 opacity-60 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="mt-1 ml-2 rounded-md border border-line bg-surface-2 p-2 font-mono text-[10.5px] leading-snug text-muted">
          <div className="text-faint">{call.name}</div>
          {input && <pre className="m-0 mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-fg">{input}</pre>}
          {call.summary && <div className="mt-1 font-sans text-[11.5px] text-fg">{call.summary}</div>}
        </div>
      )}
    </div>
  );
}
