"use client";
// "Ask Spectre": assistant drawer docked on the right. Streams the agent's answer (Claude or any
// OpenAI-compatible model) and shows each tool call (assignment, structure, processing, UI actions) as a chip.
import { useEffect, useRef, useState } from "react";
import { useSpectre, type ChatTurn } from "@/lib/client/store";
import { IconClose, IconSend, IconSparkle, IconStop, IconTrash } from "@/components/ui/Icons";
import { cx } from "@/components/ui/primitives";
import { Markdown } from "./Markdown";
import { ModelPicker } from "./ModelPicker";
import { ToolChip } from "./ToolChip";

export const QUICK_PROMPTS = [
  "Which residues have conflicts?",
  "Why is Leu 43 unconfirmed?",
  "Why is residue 24 unassigned?",
  "Show the HNCA strips for L43",
  "Predict the secondary structure from the shifts",
  "Browse the ARTINA library",
  "Import 2K50 from ARTINA",
  "Show the secondary structure from the shifts",
];

function AssistantTurn({ turn, streaming }: { turn: ChatTurn; streaming: boolean }) {
  const empty = turn.parts.length === 0;
  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-faint text-accent">
        <IconSparkle size={13} />
      </div>
      <div className="min-w-0 flex-1 text-[13.5px] leading-relaxed text-fg">
        {empty && streaming && <span className="caret text-muted">Thinking</span>}
        {turn.parts.map((part, i) =>
          part.kind === "text" ? (
            <div key={i} className={cx(streaming && i === turn.parts.length - 1 && "caret")}>
              <Markdown text={part.text} />
            </div>
          ) : turn.tools[part.id] ? (
            <ToolChip key={i} call={turn.tools[part.id]} />
          ) : null,
        )}
        {turn.stopped && <div className="mt-1 text-[11px] text-faint">Stopped.</div>}
        {turn.error && (
          <div role="alert" className="mt-2 rounded-md border border-danger/30 bg-danger-soft px-2.5 py-2 text-[12px] text-danger [&_code]:bg-surface [&_code]:text-danger">
            <Markdown text={turn.error} />
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatDrawer() {
  const { state, setChatOpen, sendChat, stopChat, clearChat } = useSpectre();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const open = state.chatOpen;
  const last = state.chat[state.chat.length - 1];

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [state.chat]);

  useEffect(() => {
    if (open) {
      const id = window.setTimeout(() => inputRef.current?.focus(), 180);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) setChatOpen(false);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setChatOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setChatOpen]);

  const submit = (text = draft) => {
    const t = text.trim();
    if (!t || state.chatStreaming) return;
    stick.current = true;
    setDraft("");
    void sendChat(t);
  };

  return (
    <>
      <aside
        aria-label="Ask Spectre assistant"
        aria-hidden={!open}
        inert={!open}
        className={cx(
          "fixed right-0 bottom-0 z-40 flex w-full flex-col border-l border-line bg-surface shadow-[var(--shadow-lg)] transition-transform duration-300 ease-out sm:w-[var(--drawer-w)]",
          open ? "translate-x-0" : "translate-x-full",
        )}
        style={{ top: "calc(var(--topbar-h) + env(safe-area-inset-top, 0px))" }}
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-accent-fg">
            <IconSparkle size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-fg">Ask Spectre</div>
            <ModelPicker />
          </div>
          {state.chat.length > 0 && (
            <button type="button" onClick={clearChat} aria-label="Clear conversation" title="Clear conversation" className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg">
              <IconTrash size={15} />
            </button>
          )}
          <button type="button" onClick={() => setChatOpen(false)} aria-label="Close assistant" className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg">
            <IconClose size={16} />
          </button>
        </div>

        <div
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
          className="scroll-quiet flex-1 space-y-5 overflow-y-auto px-4 py-4"
          aria-live="polite"
        >
          {state.chat.length === 0 && (
            <div className="space-y-4">
              <div className="rounded-lg border border-line bg-surface-2 p-3.5 text-[13px] leading-relaxed text-fg">
                <p className="m-0 font-medium">Ask anything about this assignment.</p>
                <p className="m-0 mt-1 text-muted">
                  The assistant can explain conflicts, spin systems and strips, check a residue&apos;s peaks across spectra, compare the
                  shifts with the structure, process raw Bruker FIDs, export NMR-STAR and drive the spectrum and 3D views.
                </p>
              </div>
              <div>
                <div className="mb-2 text-[11px] font-medium tracking-wide text-muted uppercase">Try</div>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_PROMPTS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => submit(q)}
                      disabled={!state.projectId}
                      className="rounded-full border border-line bg-surface px-3 py-1.5 text-left text-[12.5px] text-fg hover:border-accent hover:text-accent disabled:opacity-50"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {state.chat.map((t) =>
            t.role === "user" ? (
              <div key={t.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-[13.5px] leading-relaxed whitespace-pre-wrap text-accent-fg">
                  {t.parts.map((p) => (p.kind === "text" ? p.text : "")).join("")}
                </div>
              </div>
            ) : (
              <AssistantTurn key={t.id} turn={t} streaming={state.chatStreaming && t === last} />
            ),
          )}
        </div>

        {state.chat.length > 0 && !state.chatStreaming && (
          <div className="scroll-quiet flex gap-1.5 overflow-x-auto px-4 pb-2 [mask-image:linear-gradient(to_right,black_80%,transparent)]">
            {QUICK_PROMPTS.slice(0, 4).map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => submit(q)}
                className="shrink-0 rounded-full border border-line px-2.5 py-1 text-[11.5px] text-muted hover:border-accent hover:text-accent"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="border-t border-line p-3"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
        >
          <div className="flex items-end gap-2 rounded-xl border border-line-strong bg-surface px-3 py-2 focus-within:border-accent focus-within:shadow-[var(--ring)]">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={Math.min(6, Math.max(1, draft.split("\n").length))}
              placeholder={state.projectId ? "Ask about residues, spectra, the structure…" : "Loading project…"}
              aria-label="Message Spectre"
              className="max-h-40 min-h-[1.5rem] flex-1 resize-none bg-transparent text-[13.5px] leading-6 text-fg outline-none placeholder:text-faint focus:shadow-none"
            />
            {state.chatStreaming ? (
              <button type="button" onClick={stopChat} aria-label="Stop" title="Stop" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-fg text-bg">
                <IconStop size={14} />
              </button>
            ) : (
              <button
                type="submit"
                aria-label="Send"
                disabled={!draft.trim() || !state.projectId}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent text-accent-fg disabled:opacity-40"
              >
                <IconSend size={15} />
              </button>
            )}
          </div>
          <div className="mt-1.5 px-1 text-[10.5px] text-faint">Enter to send · Shift+Enter for a new line · ⌘K to open</div>
        </form>
      </aside>

      {/* floating shortcut for small screens; on desktop the top bar and entry header carry the button */}
      {!open && (
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          className="fixed z-30 inline-flex items-center gap-2 rounded-full bg-accent lg:hidden px-4 py-3 text-[14px] font-medium text-accent-fg shadow-[var(--shadow-lg)] hover:bg-accent-hover"
          style={{ right: "calc(1.25rem + env(safe-area-inset-right, 0px))", bottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))" }}
          aria-label="Ask Spectre"
        >
          <IconSparkle size={17} /> Ask Spectre
        </button>
      )}
    </>
  );
}
