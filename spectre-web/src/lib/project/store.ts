// Server-side project store: an in-memory Map kept on globalThis (survives dev hot reloads)
// and mirrored to .data/projects/<id>.json so projects survive restarts.
//
// Projects saved by earlier versions of the app (assigned by the former autoAssign engine or by
// earlier built-in engines) are kept on disk untouched but not offered: listProjects skips them and
// getProject treats them as not found, so the client falls back to its default project.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { RESULT_VERSION } from "../assignment";
import { rebuildAssignment } from "../peaklists/project";
import { isDemoProject, loadUbiquitinDemo } from "./demo";
import type { HistoryEntry, ProjectState } from "./types";

/** Directory for persisted projects (SPECTRE_DATA_DIR overrides, e.g. for tests). */
function dataDir(): string {
  return process.env.SPECTRE_DATA_DIR ? path.join(process.env.SPECTRE_DATA_DIR, "projects") : path.join(process.cwd(), ".data", "projects");
}
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_HISTORY = 300;

interface StoreGlobals {
  __spectreProjects?: Map<string, ProjectState>;
  __spectreLocks?: Map<string, Promise<void>>;
}
const g = globalThis as unknown as StoreGlobals;
const projects = (g.__spectreProjects ??= new Map<string, ProjectState>());
const locks = (g.__spectreLocks ??= new Map<string, Promise<void>>());

export function isProjectId(id: string): boolean {
  return ID_RE.test(id);
}

function fileFor(id: string): string {
  return path.join(dataDir(), `${id}.json`);
}

/** A project saved by an earlier version of the app (no peak-list inputs, no peak-list result). */
export function isLegacyProject(state: ProjectState): boolean {
  return !state.inputs && state.results?.assignment?.source !== "peaklists";
}

/** The same test on a project file's text (without parsing it). */
function isLegacyText(text: string): boolean {
  return !/"inputs":\{/.test(text) && !text.includes('"source":"peaklists"');
}

/** Results stored in an older layout: rebuild them from the peak lists (the demo's from its bundled lists). */
function upgradeResult(state: ProjectState): void {
  const res = state.results.assignment as { version?: number } | undefined;
  if (!res || res.version === RESULT_VERSION) return;
  if (isDemoProject(state)) {
    const demo = loadUbiquitinDemo();
    state.results.assignment = demo.results.assignment;
    state.spectra = demo.spectra;
    state.hsqc = demo.hsqc;
  } else rebuildAssignment(state);
}

/** Load a project from memory or disk; null when unknown (or saved by an earlier version). */
export function getProject(id: string): ProjectState | null {
  if (!isProjectId(id)) return null;
  const hit = projects.get(id);
  if (hit) {
    // states loaded by an earlier version of this server process (dev hot reloads)
    if (isLegacyProject(hit)) return null;
    upgradeResult(hit);
    return hit;
  }
  const file = fileFor(id);
  if (!fs.existsSync(file)) return null;
  try {
    const state = JSON.parse(fs.readFileSync(file, "utf8")) as ProjectState;
    if (state.id !== id || isLegacyProject(state)) return null;
    state.results ??= {};
    upgradeResult(state);
    projects.set(id, state);
    return state;
  } catch {
    return null;
  }
}

/** Persist a project (atomic write). */
export function saveProject(state: ProjectState): void {
  state.updatedAt = new Date().toISOString();
  if (state.history.length > MAX_HISTORY) state.history = state.history.slice(-MAX_HISTORY);
  projects.set(state.id, state);
  fs.mkdirSync(dataDir(), { recursive: true });
  const tmp = `${fileFor(state.id)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, fileFor(state.id));
}

export function addHistory(state: ProjectState, actor: HistoryEntry["actor"], action: string, detail?: string): void {
  state.history.push({ at: new Date().toISOString(), actor, action, ...(detail ? { detail: detail.slice(0, 400) } : {}) });
}

/** A new project from the bundled ubiquitin demo (its assignment built from its bundled peak lists). */
export function createProject(): ProjectState {
  const state = loadUbiquitinDemo();
  state.id = randomUUID();
  addHistory(state, "system", "create_project", `demo ${state.meta.name}`);
  saveProject(state);
  return state;
}

export interface ProjectListEntry {
  id: string;
  name: string;
  updatedAt: string;
  /** e.g. "upload", "artina:2K50" or "demo:ubiquitin" */
  source?: string;
}

/** List known projects (memory and disk), newest first. */
export function listProjects(): ProjectListEntry[] {
  const out = new Map<string, ProjectListEntry>();
  for (const s of projects.values()) {
    if (!isLegacyProject(s)) out.set(s.id, { id: s.id, name: s.meta.name, updatedAt: s.updatedAt, source: s.meta.source });
  }
  const dir = dataDir();
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      const id = f.replace(/\.json$/, "");
      if (!f.endsWith(".json") || !isProjectId(id) || out.has(id) || projects.has(id)) continue;
      try {
        const file = path.join(dir, f);
        const text = fs.readFileSync(file, "utf8");
        if (isLegacyText(text)) continue;
        // meta sits near the start of the JSON
        const head = text.slice(0, 8192);
        const name = head.match(/"meta":\{"name":"((?:[^"\\]|\\.)*)"/)?.[1];
        const source = head.match(/"source":"((?:[^"\\]|\\.)*)"/)?.[1];
        out.set(id, { id, name: name ?? "project", updatedAt: fs.statSync(file).mtime.toISOString(), ...(source ? { source } : {}) });
      } catch {
        // ignore unreadable entries
      }
    }
  }
  return [...out.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Run `fn` with exclusive access to a project (mutations are serialised per project).
 * Returns null when the project does not exist.
 */
export async function withProject<T>(id: string, fn: (state: ProjectState) => Promise<T> | T): Promise<{ state: ProjectState; value: T } | null> {
  const prev = locks.get(id) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const chained = prev.then(() => mine);
  locks.set(id, chained);
  await prev;
  try {
    const state = getProject(id);
    if (!state) return null;
    const value = await fn(state);
    return { state, value };
  } finally {
    release();
    if (locks.get(id) === chained) locks.delete(id);
  }
}
