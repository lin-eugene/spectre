// Browser-side API client for the Spectre routes (see src/lib/contract.ts).
import type {
  ActionName,
  ActionResponse,
  ArtinaProteinSummary,
  ChatEvent,
  ChatMessage,
  ImportJob,
  ProjectView,
  SpectrumViewId,
} from "@/lib/contract";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body.error === "string") return body.error;
  } catch {
    /* not json */
  }
  return `${res.status} ${res.statusText}`.trim();
}

// ------------------------------------------------------------------ your own data (spectra + peak lists)

/** A new project for your own data, from the text of a sequence file. */
export async function createUploadProject(input: { name: string; sequence: string; firstResidue: number }): Promise<string> {
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ upload: input }),
  });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return ((await res.json()) as { id: string }).id;
}

/** PUT a file to the project's uploads (streamed, with progress 0..1) → the response body. */
function putUpload<T>(projectId: string, file: File, params: Record<string, string>, onProgress?: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const q = new URLSearchParams({ ...params, file: file.name });
    xhr.open("PUT", `/api/projects/${encodeURIComponent(projectId)}/uploads?${q}`);
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          return resolve(JSON.parse(xhr.responseText) as T);
        } catch {
          return resolve({} as T);
        }
      }
      let msg = `${xhr.status} ${xhr.statusText}`;
      try {
        msg = (JSON.parse(xhr.responseText) as { error?: string }).error ?? msg;
      } catch {
        /* not json */
      }
      reject(new ApiError(msg, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError(`upload of ${file.name} failed (network error)`, 0));
    xhr.send(file);
  });
}

/** Upload one NMRPipe 3D spectrum as an experiment type (hnca, …) → its name in the project. */
export async function uploadSpectrum(projectId: string, file: File, type: string, onProgress?: (fraction: number) => void): Promise<string> {
  const body = await putUpload<{ spectrum: { name: string } }>(projectId, file, { kind: "spectrum", type }, onProgress);
  return body.spectrum.name;
}

/** Upload the assigned peak list of an uploaded spectrum (format "auto" detects it) → warnings from reading it. */
export async function uploadPeakList(projectId: string, spectrum: string, file: File, format = "auto"): Promise<{ warnings: string[] }> {
  const body = await putUpload<{ warnings?: string[] }>(projectId, file, { kind: "peaklist", spectrum, format });
  return { warnings: body.warnings ?? [] };
}

/** Upload an XEASY .prot shift list (for XEASY peak lists that give their atoms as numbers). */
export async function uploadShiftList(projectId: string, file: File): Promise<void> {
  await putUpload(projectId, file, { kind: "shiftlist" });
}

async function deleteUploads(projectId: string, q: Record<string, string>): Promise<void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/uploads?${new URLSearchParams(q)}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
}

/** Remove an uploaded spectrum with its peak list. */
export const deleteUpload = (projectId: string, name: string) => deleteUploads(projectId, { name });
/** Remove only a spectrum's peak list. */
export const deletePeakList = (projectId: string, spectrum: string) => deleteUploads(projectId, { peaklist: spectrum });
export const deleteShiftList = (projectId: string) => deleteUploads(projectId, { shiftlist: "1" });

/** Create a project from a bundled demo (the ubiquitin demo, assigned from its bundled peak lists). */
export async function createProject(demo = "ubiquitin"): Promise<string> {
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ demo }),
  });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  const body = (await res.json()) as { id: string };
  return body.id;
}

/**
 * The featured real-data project (ARTINA 2K50, assigned from its deposited peak lists): {id} when
 * it exists, {jobId} while it is being imported (no id until the import is done).
 */
export async function openFeaturedProject(): Promise<{ id?: string; jobId?: string }> {
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ demo: "2K50" }),
  });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return (await res.json()) as { id?: string; jobId?: string };
}

export async function getProject(id: string, signal?: AbortSignal): Promise<ProjectView> {
  const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, { cache: "no-store", signal });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return (await res.json()) as ProjectView;
}

export async function postAction(id: string, action: ActionName, args?: Record<string, unknown>): Promise<ActionResponse> {
  const res = await fetch(`/api/projects/${encodeURIComponent(id)}/actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, args: args ?? {} }),
  });
  let body: ActionResponse | null = null;
  try {
    body = (await res.json()) as ActionResponse;
  } catch {
    body = null;
  }
  if (!res.ok && !body) throw new ApiError(`${res.status} ${res.statusText}`, res.status);
  return body ?? { ok: false, error: `${res.status} ${res.statusText}` };
}

export interface ProjectListItem {
  id: string;
  name: string;
  updatedAt: string;
  source?: string;
}

export async function listProjects(): Promise<ProjectListItem[]> {
  const res = await fetch("/api/projects", { cache: "no-store" });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  const body = (await res.json()) as { projects?: ProjectListItem[] };
  return body.projects ?? [];
}

export async function getArtinaCatalog(): Promise<ArtinaProteinSummary[]> {
  const res = await fetch("/api/artina/catalog", { cache: "no-store" });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  const body = (await res.json()) as { proteins?: ArtinaProteinSummary[] };
  return body.proteins ?? [];
}

/** Import an ARTINA protein: download its spectra and deposited peak lists, create the project → the job id. */
export async function startArtinaImport(id: string, opts: { maxMB?: number } = {}): Promise<string> {
  const res = await fetch("/api/artina/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, ...(opts.maxMB ? { maxMB: opts.maxMB } : {}) }),
  });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  const body = (await res.json()) as { jobId: string };
  return body.jobId;
}

export async function getImportJob(jobId: string, signal?: AbortSignal): Promise<ImportJob> {
  const res = await fetch(`/api/artina/import/${encodeURIComponent(jobId)}`, { cache: "no-store", signal });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return (await res.json()) as ImportJob;
}

export function exportUrl(id: string, format: string): string {
  return `/api/projects/${encodeURIComponent(id)}/export?format=${encodeURIComponent(format)}`;
}

/** What the user is looking at, sent with each chat request so the agent can resolve "this residue". */
export interface ChatUiContext {
  selectedResidue: number | null;
  selectedRoot: string | null;
  spectrumView: SpectrumViewId;
}

/**
 * POST /api/projects/[id]/chat and parse the server-sent event stream into ChatEvents.
 * Resolves when the stream ends; rejects on network/abort errors (AbortError on stop).
 */
export async function streamChat(
  id: string,
  messages: ChatMessage[],
  onEvent: (ev: ChatEvent) => void,
  signal: AbortSignal,
  ui?: ChatUiContext,
): Promise<void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(id)}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify({ messages, ...(ui ? { ui } : {}), ...readLlmChoice() }),
    signal,
  });
  if (!res.ok || !res.body) {
    onEvent({ type: "error", message: await readError(res) });
    onEvent({ type: "done" });
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const flush = (block: string) => {
    const data = block
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data || data === "[DONE]") return;
    try {
      onEvent(JSON.parse(data) as ChatEvent);
    } catch {
      /* ignore malformed event */
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx).replace(/^\r?\n\r?\n/, "");
      flush(block);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) flush(buffer);
}

// ------------------------------------------------------------------ model provider choice

export type LlmProviderId = "anthropic" | "openai";

/** GET /api/agent/config: which model providers the server can use (no secrets). */
export interface AgentConfigView {
  providers: { id: LlmProviderId; label: string; model: string; baseURL?: string; host?: string; available: boolean }[];
  default: LlmProviderId | null;
}

export async function fetchAgentConfig(): Promise<AgentConfigView> {
  const res = await fetch("/api/agent/config", { cache: "no-store" });
  if (!res.ok) throw new ApiError(await readError(res), res.status);
  return (await res.json()) as AgentConfigView;
}

/** The provider/model this browser picked for the chat (sent with each chat request). */
export interface LlmChoice {
  provider?: LlmProviderId;
  model?: string;
}

const LLM_KEY = "spectre:llm";

export function readLlmChoice(): LlmChoice {
  try {
    const raw = JSON.parse(window.localStorage.getItem(LLM_KEY) ?? "{}") as LlmChoice;
    const out: LlmChoice = {};
    if (raw.provider === "anthropic" || raw.provider === "openai") out.provider = raw.provider;
    if (typeof raw.model === "string" && raw.model.trim()) out.model = raw.model.trim();
    return out;
  } catch {
    return {};
  }
}

export function writeLlmChoice(choice: LlmChoice): void {
  try {
    if (!choice.provider && !choice.model) window.localStorage.removeItem(LLM_KEY);
    else window.localStorage.setItem(LLM_KEY, JSON.stringify(choice));
  } catch {
    /* storage unavailable */
  }
}
