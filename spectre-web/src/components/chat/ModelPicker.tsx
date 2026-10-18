"use client";
// Compact provider/model indicator for the chat header. Shows which model answers (Claude or
// any OpenAI-compatible endpoint) and, when useful, lets this browser pick another provider or
// type a model name for the OpenAI-compatible server. The choice is sent with each chat request.
import { useEffect, useRef, useState } from "react";
import { fetchAgentConfig, readLlmChoice, writeLlmChoice, type AgentConfigView, type LlmChoice, type LlmProviderId } from "@/lib/client/api";
import { IconCheck, IconChevronDown } from "@/components/ui/Icons";
import { cx } from "@/components/ui/primitives";

let configPromise: Promise<AgentConfigView> | null = null;
function loadConfig(): Promise<AgentConfigView> {
  configPromise ??= fetchAgentConfig().catch((e) => {
    configPromise = null;
    throw e;
  });
  return configPromise;
}

export function ModelPicker() {
  const [config, setConfig] = useState<AgentConfigView | null>(null);
  const [choice, setChoice] = useState<LlmChoice>({});
  const [open, setOpen] = useState(false);
  const [draftModel, setDraftModel] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    loadConfig()
      .then((cfg) => {
        if (!live) return;
        const stored = readLlmChoice();
        // forget a stored provider the server no longer offers
        const valid = stored.provider && !cfg.providers.find((p) => p.id === stored.provider)?.available ? {} : stored;
        if (valid !== stored) writeLlmChoice(valid);
        setConfig(cfg);
        setChoice(valid);
        setDraftModel(valid.model ?? "");
      })
      .catch(() => live && setConfig({ providers: [], default: null }));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  if (!config) return <div className="truncate text-[11.5px] text-faint">Connecting…</div>;

  const available = config.providers.filter((p) => p.available);
  const activeId: LlmProviderId | null = choice.provider && available.some((p) => p.id === choice.provider) ? choice.provider : config.default;
  const active = config.providers.find((p) => p.id === activeId) ?? null;
  const model = activeId === "openai" ? choice.model || active?.model || "" : active?.model ?? "";
  const label = !active
    ? "No model configured"
    : active.id === "anthropic"
      ? `Claude · ${model}`
      : `OpenAI-compatible · ${model || "choose a model"}${active.host ? ` @ ${active.host}` : ""}`;

  const save = (next: LlmChoice) => {
    const clean: LlmChoice = {};
    if (next.provider) clean.provider = next.provider;
    if (next.model?.trim()) clean.model = next.model.trim();
    writeLlmChoice(clean);
    setChoice(clean);
  };

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Model used by the assistant"
        className={cx("flex max-w-full items-center gap-1 truncate text-[11.5px] hover:text-fg", active ? "text-muted" : "text-danger")}
      >
        <span className="truncate">{label}</span>
        <IconChevronDown size={12} />
      </button>
      {open && (
        <div role="dialog" aria-label="Choose the assistant's model" className="absolute top-6 left-0 z-50 w-[300px] max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface p-3 text-[12.5px] text-fg shadow-[var(--shadow-lg)]">
          <div className="mb-2 text-[11px] font-medium tracking-wide text-muted uppercase">Model provider</div>
          <div className="space-y-1">
            {config.providers.map((p) => {
              const selected = p.id === activeId;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={!p.available}
                  onClick={() => save({ provider: p.id, model: p.id === "openai" ? choice.model : undefined })}
                  className={cx(
                    "flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left",
                    selected ? "border-accent bg-accent-faint" : "border-line hover:border-line-strong",
                    !p.available && "cursor-not-allowed opacity-55",
                  )}
                >
                  <span className={cx("mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border", selected ? "border-accent bg-accent text-accent-fg" : "border-line-strong")}>
                    {selected && <IconCheck size={10} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium">{p.label}</span>
                    <span className="block truncate text-[11.5px] text-muted">
                      {!p.available
                        ? p.id === "anthropic"
                          ? "Not configured: set ANTHROPIC_API_KEY"
                          : "Not configured: set OPENAI_BASE_URL and OPENAI_MODEL"
                        : p.id === "openai"
                          ? `${p.host ?? p.baseURL ?? ""}${p.model ? ` · default ${p.model}` : ""}`
                          : p.model}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          {activeId === "openai" && (
            <form
              className="mt-3"
              onSubmit={(e) => {
                e.preventDefault();
                save({ provider: "openai", model: draftModel });
                setOpen(false);
              }}
            >
              <label className="mb-1 block text-[11px] font-medium tracking-wide text-muted uppercase" htmlFor="llm-model">
                Model name
              </label>
              <div className="flex gap-1.5">
                <input
                  id="llm-model"
                  value={draftModel}
                  onChange={(e) => setDraftModel(e.target.value)}
                  placeholder={active?.model || "e.g. gpt-4.1, llama3.1, qwen3"}
                  spellCheck={false}
                  autoComplete="off"
                  className="min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2 py-1 font-mono text-[12px] text-fg outline-none focus:border-accent"
                />
                <button type="submit" className="rounded-md bg-accent px-2.5 text-[12px] font-medium text-accent-fg">
                  Use
                </button>
              </div>
              <p className="m-0 mt-1.5 text-[11px] text-muted">The model must support tool (function) calling.</p>
            </form>
          )}
          {!available.length && (
            <p className="m-0 mt-3 text-[11.5px] leading-relaxed text-muted">
              Add <code>ANTHROPIC_API_KEY</code>, or an OpenAI-compatible endpoint (<code>OPENAI_BASE_URL</code>, <code>OPENAI_MODEL</code>, optional{" "}
              <code>OPENAI_API_KEY</code>) to <code>spectre-web/.env.local</code> and restart the dev server.
            </p>
          )}
          {(choice.provider || choice.model) && (
            <button
              type="button"
              onClick={() => {
                save({});
                setDraftModel("");
              }}
              className="mt-2.5 text-[11.5px] text-accent hover:underline"
            >
              Reset to the server default
            </button>
          )}
        </div>
      )}
    </div>
  );
}
