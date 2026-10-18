"use client";
// Client state for the Spectre entry page: project data (from the API), selection and view
// state shared by the sequence, spectrum and structure panels, the assistant chat (kept per
// project), the project switcher and ARTINA library imports.
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import type {
  ActionName,
  ActionResponse,
  ChatEvent,
  ChatMessage,
  ColorScheme,
  ImportJob,
  ProjectView,
  Representation,
  SpectrumViewId,
  UiAction,
} from "@/lib/contract";
import {
  ApiError,
  createProject,
  getImportJob,
  getProject,
  listProjects,
  openFeaturedProject,
  postAction,
  startArtinaImport,
  streamChat,
  type ProjectListItem,
} from "./api";

export interface ChatToolCall {
  id: string;
  name: string;
  input: unknown;
  status: "running" | "ok" | "error";
  summary?: string;
}

export type ChatPart = { kind: "text"; text: string } | { kind: "tool"; id: string };

export interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  parts: ChatPart[];
  tools: Record<string, ChatToolCall>;
  error?: string;
  pending?: boolean;
  stopped?: boolean;
}

export interface Toast {
  id: number;
  kind: "info" | "error" | "ok";
  text: string;
}

export interface SpectreState {
  projectId: string | null;
  project: ProjectView | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  busy: string | null;
  selection: { residue: number | null; root: string | null };
  hoverResidue: number | null;
  highlights: { residues: number[]; color?: string; label?: string };
  colorScheme: ColorScheme;
  representation: Representation;
  spectrumView: SpectrumViewId;
  brukerExperiment: string | null;
  /** real spectrum shown in the 'planes' view and the ppm of its slice (null = projection) */
  planeSpectrum: string | null;
  planeAt: number | null;
  chatOpen: boolean;
  chat: ChatTurn[];
  /** project the chat transcript belongs to (persisted under that id) */
  chatOwner: string | null;
  chatStreaming: boolean;
  toast: Toast | null;
  projects: ProjectListItem[];
  libraryOpen: boolean;
  importJob: ImportJob | null;
  /** "new project from your spectra" dialog */
  uploadOpen: boolean;
}

type Action =
  | { type: "switch"; id: string }
  | { type: "load_start" }
  | { type: "load_ok"; project: ProjectView }
  | { type: "load_err"; error: string }
  | { type: "busy"; label: string | null }
  | { type: "select_residue"; residue: number | null }
  | { type: "select_root"; root: string | null }
  | { type: "hover"; residue: number | null }
  | { type: "highlight"; residues: number[]; color?: string; label?: string }
  | { type: "clear_highlights" }
  | { type: "scheme"; scheme: ColorScheme }
  | { type: "representation"; representation: Representation }
  | { type: "view"; view: SpectrumViewId }
  | { type: "bruker"; experiment: string | null }
  | { type: "plane"; spectrum: string | null; at: number | null }
  | { type: "chat_open"; open: boolean }
  | { type: "chat_user"; turn: ChatTurn }
  | { type: "chat_assistant"; turn: ChatTurn }
  | { type: "chat_event"; turnId: string; event: ChatEvent }
  | { type: "chat_end"; turnId: string; stopped?: boolean; error?: string }
  | { type: "chat_set"; chat: ChatTurn[]; owner: string | null }
  | { type: "chat_clear" }
  | { type: "toast"; toast: Toast | null }
  | { type: "projects"; projects: ProjectListItem[] }
  | { type: "library"; open: boolean }
  | { type: "import_job"; job: ImportJob | null }
  | { type: "upload_open"; open: boolean };

const initialState: SpectreState = {
  projectId: null,
  project: null,
  status: "idle",
  error: null,
  busy: null,
  selection: { residue: null, root: null },
  hoverResidue: null,
  highlights: { residues: [] },
  colorScheme: "confidence",
  representation: "cartoon+atoms",
  spectrumView: "strips3d",
  brukerExperiment: null,
  planeSpectrum: null,
  planeAt: null,
  chatOpen: false,
  chat: [],
  chatOwner: null,
  chatStreaming: false,
  toast: null,
  projects: [],
  libraryOpen: false,
  importJob: null,
  uploadOpen: false,
};

const VIEWS: SpectrumViewId[] = ["hsqc", "strips", "strips3d", "matrix", "bruker1d", "planes"];
const SCHEMES: ColorScheme[] = ["confidence", "secondary", "residue", "hydrophobicity", "bfactor"];

/** Residue number from an atom label like "43L". */
export function resiFromLabel(label: string | undefined | null): number | null {
  if (!label) return null;
  const m = label.match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
}

export function rootForResidue(project: ProjectView | null, residue: number | null): string | null {
  if (!project?.assignment || residue === null) return null;
  return project.assignment.residues.find((r) => r.resi === residue)?.root ?? null;
}

export function residueForRoot(project: ProjectView | null, root: string | null): number | null {
  if (!project?.assignment || root === null) return null;
  const ss = project.assignment.spinSystems.find((s) => s.root === root);
  return resiFromLabel(ss?.residue);
}

function updateTurn(chat: ChatTurn[], id: string, fn: (t: ChatTurn) => ChatTurn): ChatTurn[] {
  return chat.map((t) => (t.id === id ? fn(t) : t));
}

function reducer(state: SpectreState, a: Action): SpectreState {
  switch (a.type) {
    case "switch":
      if (state.projectId === a.id) return state;
      return {
        ...state,
        projectId: a.id,
        project: null,
        status: "loading",
        error: null,
        selection: { residue: null, root: null },
        hoverResidue: null,
        highlights: { residues: [] },
        planeSpectrum: null,
        planeAt: null,
      };
    case "load_start":
      return { ...state, status: state.project ? state.status : "loading", error: null };
    case "load_ok":
      if (a.project.id && state.projectId && a.project.id !== state.projectId) return state; // stale response
      return { ...state, project: a.project, status: "ready", error: null };
    case "load_err":
      return { ...state, status: state.project ? "ready" : "error", error: a.error };
    case "busy":
      return { ...state, busy: a.label };
    case "select_residue": {
      const root = rootForResidue(state.project, a.residue);
      return { ...state, selection: { residue: a.residue, root } };
    }
    case "select_root": {
      const residue = residueForRoot(state.project, a.root);
      return { ...state, selection: { residue, root: a.root } };
    }
    case "hover":
      return state.hoverResidue === a.residue ? state : { ...state, hoverResidue: a.residue };
    case "highlight":
      return { ...state, highlights: { residues: a.residues, color: a.color, label: a.label } };
    case "clear_highlights":
      return { ...state, highlights: { residues: [] } };
    case "scheme":
      return { ...state, colorScheme: a.scheme };
    case "representation":
      return { ...state, representation: a.representation };
    case "view":
      return { ...state, spectrumView: a.view };
    case "bruker":
      return { ...state, brukerExperiment: a.experiment };
    case "plane":
      return { ...state, planeSpectrum: a.spectrum, planeAt: a.at };
    case "chat_open":
      return { ...state, chatOpen: a.open };
    case "chat_user":
      return { ...state, chat: [...state.chat, a.turn] };
    case "chat_assistant":
      return { ...state, chat: [...state.chat, a.turn], chatStreaming: true };
    case "chat_event": {
      const ev = a.event;
      if (ev.type === "text_delta") {
        return {
          ...state,
          chat: updateTurn(state.chat, a.turnId, (t) => {
            const parts = [...t.parts];
            const last = parts[parts.length - 1];
            if (last && last.kind === "text") parts[parts.length - 1] = { kind: "text", text: last.text + ev.text };
            else parts.push({ kind: "text", text: ev.text });
            return { ...t, parts };
          }),
        };
      }
      if (ev.type === "tool_start") {
        return {
          ...state,
          chat: updateTurn(state.chat, a.turnId, (t) => ({
            ...t,
            parts: [...t.parts, { kind: "tool", id: ev.id }],
            tools: { ...t.tools, [ev.id]: { id: ev.id, name: ev.name, input: ev.input, status: "running" } },
          })),
        };
      }
      if (ev.type === "tool_end") {
        return {
          ...state,
          chat: updateTurn(state.chat, a.turnId, (t) => {
            const prev = t.tools[ev.id];
            const call: ChatToolCall = {
              id: ev.id,
              name: ev.name || prev?.name || "tool",
              input: prev?.input,
              status: ev.ok ? "ok" : "error",
              summary: ev.summary,
            };
            const parts = prev ? t.parts : [...t.parts, { kind: "tool" as const, id: ev.id }];
            return { ...t, parts, tools: { ...t.tools, [ev.id]: call } };
          }),
        };
      }
      if (ev.type === "error") {
        return { ...state, chat: updateTurn(state.chat, a.turnId, (t) => ({ ...t, error: ev.message })) };
      }
      return state;
    }
    case "chat_end":
      return {
        ...state,
        chatStreaming: false,
        chat: updateTurn(state.chat, a.turnId, (t) => ({
          ...t,
          pending: false,
          stopped: a.stopped || t.stopped,
          error: a.error ?? t.error,
          tools: Object.fromEntries(
            Object.entries(t.tools).map(([k, v]) => [k, v.status === "running" ? { ...v, status: a.stopped ? "error" : "ok" } : v]),
          ) as Record<string, ChatToolCall>,
        })),
      };
    case "chat_set":
      return { ...state, chat: a.chat, chatOwner: a.owner };
    case "chat_clear":
      return { ...state, chat: [], chatStreaming: false };
    case "toast":
      return { ...state, toast: a.toast };
    case "projects":
      return { ...state, projects: a.projects };
    case "library":
      return { ...state, libraryOpen: a.open };
    case "import_job":
      return { ...state, importJob: a.job };
    case "upload_open":
      return { ...state, uploadOpen: a.open };
  }
}

export interface SpectreApi {
  state: SpectreState;
  refetch: () => Promise<void>;
  /** create a fresh ubiquitin demo project and open it */
  resetDemo: () => Promise<void>;
  switchProject: (id: string, opts?: { carryChat?: boolean }) => Promise<void>;
  refreshProjects: () => Promise<void>;
  runAction: (action: ActionName, args?: Record<string, unknown>, label?: string) => Promise<ActionResponse>;
  applyUi: (action: UiAction) => void;
  selectResidue: (residue: number | null) => void;
  selectRoot: (root: string | null) => void;
  hoverResidue: (residue: number | null) => void;
  setColorScheme: (scheme: ColorScheme) => void;
  setRepresentation: (repr: Representation) => void;
  setSpectrumView: (view: SpectrumViewId) => void;
  setBrukerExperiment: (exp: string) => void;
  setPlane: (spectrum: string | null, at: number | null) => void;
  clearHighlights: () => void;
  setChatOpen: (open: boolean) => void;
  sendChat: (text: string) => Promise<void>;
  stopChat: () => void;
  clearChat: () => void;
  notify: (text: string, kind?: Toast["kind"]) => void;
  setLibraryOpen: (open: boolean) => void;
  /** import an ARTINA protein (download its spectra and deposited peak lists); the new project opens when it exists */
  startImport: (proteinId: string, opts?: { maxMB?: number }) => Promise<void>;
  /** open the featured real-data project (ARTINA 2K50), importing it the first time */
  openFeatured: () => Promise<void>;
  dismissImport: () => void;
  setUploadOpen: (open: boolean) => void;
}

const Ctx = createContext<SpectreApi | null>(null);
const PROJECT_KEY = "spectre:projectId";
const IMPORT_KEY = "spectre:importJob";
const chatKey = (id: string) => `spectre:chat:${id}`;

let turnCounter = 0;
const newId = (p: string) => `${p}-${Date.now().toString(36)}-${(turnCounter++).toString(36)}`;

function turnText(t: ChatTurn): string {
  return t.parts
    .filter((p): p is { kind: "text"; text: string } => p.kind === "text")
    .map((p) => p.text)
    .join("")
    .trim();
}

function readStoredChat(id: string): ChatTurn[] {
  try {
    const raw = window.localStorage.getItem(chatKey(id));
    return raw ? (JSON.parse(raw) as ChatTurn[]) : [];
  } catch {
    return [];
  }
}

/** Remove a one-shot query parameter from the address bar (no navigation). */
function dropQueryParam(name: string) {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(name)) return;
  url.searchParams.delete(name);
  window.history.replaceState(window.history.state, "", url);
}

function store(key: string, value: string | null, session = false) {
  try {
    const s = session ? window.sessionStorage : window.localStorage;
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

export function SpectreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });
  const abortRef = useRef<AbortController | null>(null);
  const loadSeq = useRef(0);
  const toastSeq = useRef(0);
  const pollRef = useRef<number | null>(null);
  /** ?open=2k50 (the landing page's real-data link), read once; null until bootstrap reads it */
  const featuredLink = useRef<boolean | null>(null);
  /** the ARTINA import being polled */
  const pollingJob = useRef<string | null>(null);

  const notify = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = ++toastSeq.current;
    dispatch({ type: "toast", toast: { id, kind, text } });
    window.setTimeout(() => {
      if (toastSeq.current === id) dispatch({ type: "toast", toast: null });
    }, kind === "error" ? 7000 : 3500);
  }, []);

  const loadProject = useCallback(async (id: string) => {
    const seq = ++loadSeq.current;
    dispatch({ type: "load_start" });
    const project = await getProject(id);
    if (seq === loadSeq.current) dispatch({ type: "load_ok", project });
  }, []);

  const refreshProjects = useCallback(async () => {
    try {
      dispatch({ type: "projects", projects: await listProjects() });
    } catch {
      /* list is optional */
    }
  }, []);

  /** Open another project. carryChat keeps the running conversation (agent-initiated switch). */
  const switchProject = useCallback(
    async (id: string, opts: { carryChat?: boolean } = {}) => {
      const cur = stateRef.current;
      if (!opts.carryChat && cur.chatStreaming) abortRef.current?.abort();
      if (cur.projectId !== id) {
        dispatch({ type: "switch", id });
        dispatch({ type: "chat_set", chat: opts.carryChat ? cur.chat : readStoredChat(id), owner: id });
        store(PROJECT_KEY, id);
      }
      try {
        await loadProject(id);
      } catch (e) {
        const msg = e instanceof ApiError && e.status === 404 ? `Project ${id.slice(0, 8)} no longer exists` : e instanceof Error ? e.message : String(e);
        dispatch({ type: "load_err", error: msg });
        notify(msg, "error");
      }
    },
    [loadProject, notify],
  );

  const bootstrap = useCallback(
    async (forceNew = false) => {
      dispatch({ type: "load_start" });
      let linked: string | null = null;
      let stored: string | null = null;
      try {
        linked = new URLSearchParams(window.location.search).get("project");
        stored = window.localStorage.getItem(PROJECT_KEY);
      } catch {
        /* storage unavailable */
      }
      if (featuredLink.current === null) {
        featuredLink.current = /^2k50$/i.test(new URLSearchParams(window.location.search).get("open") ?? "");
        dropQueryParam("open");
      }
      // ?project=<id> deep link wins over the remembered project
      const deep = !forceNew && linked && /^[0-9a-f-]{36}$/i.test(linked) ? linked : null;
      const featured = !forceNew && !deep && featuredLink.current;
      featuredLink.current = false;
      const open = async (id: string) => {
        store(PROJECT_KEY, id);
        dispatch({ type: "switch", id });
        dispatch({ type: "chat_set", chat: readStoredChat(id), owner: id });
        await loadProject(id);
      };
      try {
        if (featured) {
          // straight into the featured real-data project when it exists on this machine. The first
          // time it is imported (download, then build): the follow-up effect below polls the import
          // and opens the project when it exists; the usual project opens meanwhile
          const res = await openFeaturedProject().catch(() => null);
          if (res?.jobId) {
            store(IMPORT_KEY, res.jobId, true);
            dispatch({
              type: "import_job",
              job: { jobId: res.jobId, proteinId: "2K50", status: "queued", progress: 0, message: "Queued", log: [] },
            });
            notify("Downloading the real 2K50 spectra and their assigned peak lists from nmrdb.ethz.ch (once, about 185 MB)", "info");
          }
          if (res?.id) {
            await open(res.id);
            return;
          }
        }
        const id = forceNew ? null : (deep ?? stored);
        if (id) {
          try {
            await open(id);
            return;
          } catch (e) {
            if (!(e instanceof ApiError) || e.status !== 404) throw e;
          }
        }
        await open(await createProject("ubiquitin"));
      } catch (e) {
        const msg =
          e instanceof ApiError && e.status === 404
            ? "The Spectre API is not available yet (POST /api/projects returned 404)."
            : e instanceof Error
              ? e.message
              : String(e);
        dispatch({ type: "load_err", error: msg });
      }
    },
    [loadProject, notify],
  );

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // deep links: ?residue=43 | ?root=12 | ?view=planes | ?experiment=HNCA | ?at=55.2 | ?scheme=secondary | ?chat=open | ?library=open
  // (?project=<id> and ?open=2k50 are handled by bootstrap)
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || !state.project) return;
    deepLinked.current = true;
    const q = new URLSearchParams(window.location.search);
    const view = q.get("view") as SpectrumViewId | null;
    if (view && VIEWS.includes(view)) dispatch({ type: "view", view });
    const scheme = q.get("scheme") as ColorScheme | null;
    if (scheme && SCHEMES.includes(scheme)) dispatch({ type: "scheme", scheme });
    const exp = q.get("experiment");
    const at = q.get("at");
    if (exp && view === "planes") dispatch({ type: "plane", spectrum: exp, at: at && !Number.isNaN(Number(at)) ? Number(at) : null });
    else if (exp) dispatch({ type: "bruker", experiment: exp });
    const residue = q.get("residue");
    const root = q.get("root");
    if (residue && /^-?\d+$/.test(residue)) dispatch({ type: "select_residue", residue: parseInt(residue, 10) });
    else if (root) dispatch({ type: "select_root", root });
    if (q.get("chat") === "open" || q.get("chat") === "1") dispatch({ type: "chat_open", open: true });
  }, [state.project]);

  // the library does not need a loaded project
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("library") === "open" || q.get("library") === "1") dispatch({ type: "library", open: true });
  }, []);

  // persist the chat transcript under the project it belongs to
  useEffect(() => {
    if (!state.chatOwner || state.chatStreaming) return;
    store(chatKey(state.chatOwner), JSON.stringify(state.chat.slice(-40)));
  }, [state.chat, state.chatStreaming, state.chatOwner]);

  const refetch = useCallback(async () => {
    const id = stateRef.current.projectId;
    if (!id) return;
    try {
      await loadProject(id);
    } catch (e) {
      dispatch({ type: "load_err", error: e instanceof Error ? e.message : String(e) });
    }
  }, [loadProject]);

  const applyUi = useCallback(
    (a: UiAction) => {
      switch (a.type) {
        case "focus_residue":
          dispatch({ type: "select_residue", residue: a.residue });
          break;
        case "select_root":
          dispatch({ type: "select_root", root: a.root });
          break;
        case "show_spectrum":
          dispatch({ type: "view", view: a.view });
          if (a.view === "planes") dispatch({ type: "plane", spectrum: a.experiment ?? stateRef.current.planeSpectrum, at: a.at ?? null });
          else if (a.experiment) dispatch({ type: "bruker", experiment: a.experiment });
          if (a.root) dispatch({ type: "select_root", root: a.root });
          else if (a.residues && a.residues.length) {
            dispatch({ type: "select_residue", residue: a.residues[0] });
            if (a.residues.length > 1) dispatch({ type: "highlight", residues: a.residues });
          }
          break;
        case "highlight_residues":
          dispatch({ type: "highlight", residues: a.residues, color: a.color, label: a.label });
          break;
        case "color_structure":
          dispatch({ type: "scheme", scheme: a.scheme });
          break;
        case "set_representation":
          dispatch({ type: "representation", representation: a.representation });
          break;
        case "clear_highlights":
          dispatch({ type: "clear_highlights" });
          break;
        case "switch_project":
          void switchProject(a.projectId, { carryChat: true }).then(() => refreshProjects());
          break;
      }
    },
    [switchProject, refreshProjects],
  );

  const runAction = useCallback(
    async (action: ActionName, args?: Record<string, unknown>, label?: string): Promise<ActionResponse> => {
      const id = stateRef.current.projectId;
      if (!id) return { ok: false, error: "No project loaded" };
      dispatch({ type: "busy", label: label ?? action.replace(/_/g, " ") });
      try {
        const res = await postAction(id, action, args);
        const switching = res.ui?.some((u) => u.type === "switch_project");
        res.ui?.forEach(applyUi);
        if (res.changed && !switching) await refetch();
        if (!res.ok) notify(res.error ?? `${action} failed`, "error");
        return res;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        notify(msg, "error");
        return { ok: false, error: msg };
      } finally {
        dispatch({ type: "busy", label: null });
      }
    },
    [applyUi, notify, refetch],
  );

  // ------------------------------------------------------------ ARTINA imports
  // An import downloads the spectra and their deposited peak lists, then creates the project; the
  // project opens when the job reports it.
  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    pollingJob.current = null;
  }, []);

  const pollJob = useCallback(
    (jobId: string) => {
      stopPolling();
      pollingJob.current = jobId;
      /** stored as "<jobId>:opened" once its project was opened, so a reload does not reopen it */
      let opened = false;
      try {
        opened = window.sessionStorage.getItem(IMPORT_KEY) === `${jobId}:opened`;
      } catch {
        /* storage unavailable */
      }
      const finish = () => {
        store(IMPORT_KEY, null, true);
        pollRef.current = null;
        pollingJob.current = null;
      };
      const tick = async () => {
        try {
          const job = await getImportJob(jobId);
          if (pollingJob.current !== jobId) return;
          dispatch({ type: "import_job", job });
          if (job.projectId && !opened) {
            opened = true;
            if (job.status !== "done" && job.status !== "error") store(IMPORT_KEY, `${jobId}:opened`, true);
            dispatch({ type: "library", open: false });
            if (stateRef.current.projectId !== job.projectId) {
              notify(`Imported ${job.proteinId}: opening it`, "ok");
              await switchProject(job.projectId);
            }
            void refreshProjects();
          }
          if (job.status === "done") {
            finish();
            notify(`${job.proteinId}: ${job.message}`, "ok");
            return;
          }
          if (job.status === "error") {
            finish();
            notify(`Import of ${job.proteinId} failed: ${job.error ?? job.message}`, "error");
            if (!stateRef.current.project) dispatch({ type: "load_err", error: `Could not import ${job.proteinId}: ${job.error ?? job.message}` });
            return;
          }
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) {
            finish();
            dispatch({ type: "import_job", job: null });
            return;
          }
        }
        pollRef.current = window.setTimeout(() => void tick(), 1000);
      };
      void tick();
    },
    [notify, refreshProjects, switchProject, stopPolling],
  );

  // resume polling a job started before a reload
  useEffect(() => {
    let jobId: string | null = null;
    try {
      jobId = window.sessionStorage.getItem(IMPORT_KEY)?.replace(/:opened$/, "") ?? null;
    } catch {
      jobId = null;
    }
    if (jobId) pollJob(jobId);
    return () => stopPolling();
  }, [pollJob, stopPolling]);

  // follow an import as soon as it is known (started here, by bootstrap or by openFeatured)
  const followId = state.importJob && (state.importJob.status === "queued" || state.importJob.status === "downloading" || state.importJob.status === "processing") ? state.importJob.jobId : null;
  useEffect(() => {
    if (followId && pollingJob.current !== followId) pollJob(followId);
  }, [followId, pollJob]);

  const startImport = useCallback(
    async (proteinId: string, opts: { maxMB?: number } = {}) => {
      const running = stateRef.current.importJob;
      if (running && (running.status === "queued" || running.status === "downloading" || running.status === "processing")) {
        notify(`An import of ${running.proteinId} is already running`, "info");
        return;
      }
      try {
        const jobId = await startArtinaImport(proteinId, opts);
        store(IMPORT_KEY, jobId, true);
        dispatch({ type: "import_job", job: { jobId, proteinId, status: "queued", progress: 0, message: "Queued", log: [] } });
      } catch (e) {
        const msg =
          e instanceof ApiError && e.status === 404 ? "The ARTINA import service is not available yet." : e instanceof Error ? e.message : String(e);
        notify(msg, "error");
      }
    },
    [notify],
  );

  /** Open the featured real-data project (ARTINA 2K50), importing it (download, build) the first time. */
  const openFeatured = useCallback(async () => {
    try {
      const res = await openFeaturedProject();
      if (res.jobId && stateRef.current.importJob?.jobId !== res.jobId) {
        store(IMPORT_KEY, res.jobId, true);
        dispatch({
          type: "import_job",
          job: { jobId: res.jobId, proteinId: "2K50", status: "queued", progress: 0, message: "Queued", log: [] },
        });
        notify("Downloading the real 2K50 spectra and their assigned peak lists from nmrdb.ethz.ch (once, about 185 MB)", "info");
      }
      if (res.id) {
        await switchProject(res.id);
        void refreshProjects();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify(msg, "error");
      if (!stateRef.current.project) dispatch({ type: "load_err", error: msg });
    }
  }, [notify, refreshProjects, switchProject]);

  // ------------------------------------------------------------ chat
  const sendChat = useCallback(
    async (text: string) => {
      const s = stateRef.current;
      const id = s.projectId;
      const content = text.trim();
      if (!id || !content || s.chatStreaming) return;
      const userTurn: ChatTurn = { id: newId("u"), role: "user", parts: [{ kind: "text", text: content }], tools: {} };
      const assistant: ChatTurn = { id: newId("a"), role: "assistant", parts: [], tools: {}, pending: true };
      const history: ChatMessage[] = [...s.chat, userTurn]
        .map((t) => ({ role: t.role, content: turnText(t) }))
        .filter((m) => m.content.length > 0);
      if (!s.chatOwner) dispatch({ type: "chat_set", chat: s.chat, owner: id });
      dispatch({ type: "chat_open", open: true });
      dispatch({ type: "chat_user", turn: userTurn });
      dispatch({ type: "chat_assistant", turn: assistant });
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      let refetchTimer: number | null = null;
      const scheduleRefetch = () => {
        if (refetchTimer !== null) return;
        refetchTimer = window.setTimeout(() => {
          refetchTimer = null;
          void refetch();
        }, 250);
      };
      let ended = false;
      try {
        await streamChat(
          id,
          history,
          (ev) => {
            if (ev.type === "ui") applyUi(ev.action);
            else if (ev.type === "state_changed") scheduleRefetch();
            else if (ev.type === "done") {
              ended = true;
              dispatch({ type: "chat_end", turnId: assistant.id });
            } else dispatch({ type: "chat_event", turnId: assistant.id, event: ev });
          },
          ctrl.signal,
          { selectedResidue: s.selection.residue, selectedRoot: s.selection.root, spectrumView: s.spectrumView },
        );
        if (!ended) dispatch({ type: "chat_end", turnId: assistant.id });
      } catch (e) {
        const aborted = e instanceof DOMException && e.name === "AbortError";
        dispatch({
          type: "chat_end",
          turnId: assistant.id,
          stopped: aborted,
          error: aborted ? undefined : e instanceof Error ? e.message : String(e),
        });
      } finally {
        abortRef.current = null;
        if (refetchTimer !== null) {
          window.clearTimeout(refetchTimer);
          void refetch();
        }
      }
    },
    [applyUi, refetch],
  );

  const api = useMemo<SpectreApi>(
    () => ({
      state,
      refetch,
      resetDemo: async () => {
        try {
          const id = await createProject("ubiquitin");
          await switchProject(id);
          void refreshProjects();
          notify("New ubiquitin demo project created", "ok");
        } catch {
          await bootstrap(true);
        }
      },
      switchProject,
      refreshProjects,
      runAction,
      applyUi,
      selectResidue: (residue) => dispatch({ type: "select_residue", residue }),
      selectRoot: (root) => dispatch({ type: "select_root", root }),
      hoverResidue: (residue) => dispatch({ type: "hover", residue }),
      setColorScheme: (scheme) => dispatch({ type: "scheme", scheme }),
      setRepresentation: (representation) => dispatch({ type: "representation", representation }),
      setSpectrumView: (view) => dispatch({ type: "view", view }),
      setBrukerExperiment: (experiment) => dispatch({ type: "bruker", experiment }),
      setPlane: (spectrum, at) => dispatch({ type: "plane", spectrum, at }),
      clearHighlights: () => dispatch({ type: "clear_highlights" }),
      setChatOpen: (open) => dispatch({ type: "chat_open", open }),
      sendChat,
      stopChat: () => abortRef.current?.abort(),
      clearChat: () => {
        abortRef.current?.abort();
        dispatch({ type: "chat_clear" });
      },
      notify,
      setLibraryOpen: (open) => dispatch({ type: "library", open }),
      startImport,
      openFeatured,
      dismissImport: () => {
        const j = stateRef.current.importJob;
        if (j && (j.status === "done" || j.status === "error")) dispatch({ type: "import_job", job: null });
      },
      setUploadOpen: (open) => dispatch({ type: "upload_open", open }),
    }),
    [state, refetch, switchProject, refreshProjects, bootstrap, runAction, applyUi, sendChat, notify, startImport, openFeatured],
  );

  // development aid: drive the store from the browser console / automated UI tests
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") (window as unknown as { __spectre?: SpectreApi }).__spectre = api;
  }, [api]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useSpectre(): SpectreApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSpectre must be used inside <SpectreProvider>");
  return v;
}
