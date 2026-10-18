// Project actions: the single entry point used by the REST route (UI buttons) and by the chat
// agent (tools). Every action works on a ProjectState (mutating it only where it says so) and
// returns a compact, LLM-friendly result plus optional UI effects. ACTION_SPECS doubles as the
// agent's tool definitions. Backbone assignments come from the project's assigned peak lists.
import type { ActionName, ColorScheme, ImportJob, Representation, SpectrumViewId, UiAction } from "../contract";
import { ACTION_NAMES, CONFIDENCE } from "../contract";
import type { AssignedPeak, AssignmentResult, Consistency, SpinSystem } from "../assignment";
import { EXPORT_FORMATS, EXPORT_LABELS, exportResults, type ExportFormat } from "../export";
import { chemicalShiftIndex, modelFor, structureNeighbours } from "../structure/analysis";
import { EXPERIMENTS } from "../spectra/experiments";
import { P1TO3 } from "../residues";
import { parsePdb } from "../structure/pdb";
import type { ProjectState } from "./types";
import { TOLERANCE } from "../peaklists/build";
import { attachAlphafoldModel, attachEsmfoldModel } from "./structure";

// ----------------------------------------------------------------------------------- schema
export interface JsonSchema {
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array";
  description?: string;
  enum?: (string | number)[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
}

/** Minimal JSON-schema check (types, enums, required, ranges, unknown keys). */
export function validateArgs(schema: JsonSchema, value: unknown, path = "args"): string | null {
  if (schema.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return `${path} must be an object`;
    const obj = value as Record<string, unknown>;
    for (const k of schema.required ?? []) if (obj[k] === undefined || obj[k] === null) return `${path}.${k} is required`;
    for (const [k, v] of Object.entries(obj)) {
      const sub = schema.properties?.[k];
      if (!sub) {
        if (schema.additionalProperties === false) return `${path}.${k} is not a known argument`;
        continue;
      }
      if (v === undefined || v === null) continue;
      const err = validateArgs(sub, v, `${path}.${k}`);
      if (err) return err;
    }
    return null;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) return `${path} must be an array`;
    if (schema.minItems !== undefined && value.length < schema.minItems) return `${path} needs at least ${schema.minItems} items`;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return `${path} allows at most ${schema.maxItems} items`;
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        const err = validateArgs(schema.items, value[i], `${path}[${i}]`);
        if (err) return err;
      }
    }
    return null;
  }
  if (schema.type === "string") {
    if (typeof value !== "string") return `${path} must be a string`;
  } else if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) return `${path} must be a number`;
    if (schema.type === "integer" && !Number.isInteger(value)) return `${path} must be an integer`;
    if (schema.minimum !== undefined && value < schema.minimum) return `${path} must be ≥ ${schema.minimum}`;
    if (schema.maximum !== undefined && value > schema.maximum) return `${path} must be ≤ ${schema.maximum}`;
  } else if (schema.type === "boolean") {
    if (typeof value !== "boolean") return `${path} must be true or false`;
  }
  if (schema.enum && !schema.enum.includes(value as string | number)) return `${path} must be one of ${schema.enum.join(", ")}`;
  return null;
}

const obj = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

// ----------------------------------------------------------------------------------- types
export interface ActionContext {
  actor: "user" | "agent" | "system";
  fetchImpl?: typeof fetch;
}

export interface ActionOutcome {
  ok: boolean;
  result?: unknown;
  error?: string;
  ui?: UiAction[];
  changed?: boolean;
  /** one-line human summary (tool chips, history) */
  summary: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: JsonSchema;
}

interface ActionImpl extends ToolSpec {
  run: (state: ProjectState, args: Record<string, unknown>, ctx: ActionContext) => Promise<ActionOutcome> | ActionOutcome;
}

const fail = (error: string): ActionOutcome => ({ ok: false, error, summary: error });
const r2 = (x: number | undefined, d = 2) => (x === undefined || !Number.isFinite(x) ? undefined : +x.toFixed(d));
const sci = (x: number) => +x.toPrecision(3);


// ----------------------------------------------------------------------------------- helpers
function needAssignment(state: ProjectState): AssignmentResult | string {
  const r = state.results.assignment;
  if (r) return r;
  return state.inputs ? "no assignment yet: the user has to add the assigned peak list of at least one spectrum (project menu, or the Inputs panel)" : "this project has no assignment";
}

function spinOf(res: AssignmentResult, root: string): SpinSystem | undefined {
  return res.spinSystems.find((s) => s.root === String(root));
}

function rootOfResidue(res: AssignmentResult, resi: number): string | undefined {
  return res.residues.find((r) => r.resi === resi)?.root;
}

function residueNumberOf(tag: string | undefined): number | undefined {
  if (!tag) return undefined;
  const n = parseInt(tag, 10);
  return Number.isFinite(n) ? n : undefined;
}

/** "12L" → "Leu 12" */
function tagLabel(tag: string | undefined): string {
  if (!tag) return "no residue";
  const resi = parseInt(tag, 10);
  const resn = tag.slice(String(resi).length);
  return `${P1TO3[resn] ?? resn} ${resi}`;
}

/** Consistency class of an assignment in words. */
function consistencyText(c: Consistency | undefined): string {
  if (!c) return "unassigned";
  return `${CONFIDENCE[c].label.toLowerCase()} (${CONFIDENCE[c].description.toLowerCase()})`;
}

/** The conflicts and unusual shifts of a spin system (what decides its consistency class). */
const checks = (spin: SpinSystem) => spin.issues.filter((i) => i.kind === "conflict" || i.kind === "unusual").map((i) => `${i.kind}: ${i.text}`);

/** Carbon shifts of a spin system per label (CA(i), CB(i-1), CO(i), ...), across spectra. */
function labelValues(spin: SpinSystem): Record<string, number[]> {
  const acc: Record<string, number[]> = {};
  for (const p of spin.peaks) if (p.label) (acc[p.label] ??= []).push(p.cp);
  return acc;
}

function medianOf(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** Representative (median) shift per label. */
function labelShifts(spin: SpinSystem): Record<string, number> {
  return Object.fromEntries(Object.entries(labelValues(spin)).map(([k, v]) => [k, medianOf(v)]));
}

/** Per-residue backbone shifts (HN, N, CA, CB, CO): means over the assigned peaks. */
export function residueShiftTable(res: AssignmentResult): Record<string, Record<string, number>> {
  return Object.fromEntries(res.residues.filter((r) => Object.keys(r.shifts).length).map((r) => [String(r.resi), r.shifts]));
}

function resLabel(state: ProjectState, resi: number): string {
  const resn = state.sequence[resi - state.firstResidue];
  return resn ? `${P1TO3[resn] ?? resn} ${resi}` : `residue ${resi}`;
}

function residueExists(state: ProjectState, resi: number): boolean {
  return resi >= state.firstResidue && resi < state.firstResidue + state.sequence.length;
}

const unexplained = (peaks: AssignedPeak[]) => peaks.filter((p) => !p.label).length;

function assignmentSummary(state: ProjectState) {
  const res = state.results.assignment;
  if (!res) return undefined;
  return {
    source: "the project's assigned peak lists",
    stats: res.stats,
    consistencyClasses: `veryHigh = ${CONFIDENCE.veryHigh.label} (${CONFIDENCE.veryHigh.description}); high = ${CONFIDENCE.high.label} (${CONFIDENCE.high.description}); low = ${CONFIDENCE.low.label} (${CONFIDENCE.low.description})`,
    peakLists: res.inputs.map((i) => ({ spectrum: i.spectrum, experiment: i.label, format: i.format, file: i.file, peaks: i.peaks, used: i.used, skipped: Object.keys(i.skipped).length ? i.skipped : undefined })),
    notes: res.notes.length ? res.notes : undefined,
  };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ----------------------------------------------------------------------------------- actions
const ACTIONS: Record<ActionName, ActionImpl> = {
  get_project_summary: {
    name: "get_project_summary",
    description:
      "Overview of the current project: protein, sequence, spectra with their assigned peak lists (peaks read, used and left out), and the backbone assignment statistics (residues per consistency class, sequential links). Call this first when you need context.",
    input_schema: obj({}),
    run(state) {
      const result = {
        name: state.meta.name,
        organism: state.meta.organism,
        pdbId: state.pdb?.id ?? state.meta.pdbId,
        bmrbId: state.meta.bmrbId,
        description: state.meta.description,
        sequence: state.sequence,
        firstResidue: state.firstResidue,
        residues: state.sequence.length,
        prolines: [...state.sequence].map((c, i) => (c === "P" ? state.firstResidue + i : -1)).filter((x) => x >= 0),
        spectra: state.spectra.map((s) => ({ type: s.tp, label: EXPERIMENTS[s.tp]?.label ?? s.tp, peaks: s.peaks.length })),
        spinSystems: state.hsqc.length,
        assignment: assignmentSummary(state),
        realSpectra: state.realSpectra?.length || undefined,
        ...(state.inputs
          ? {
              inputs: state.inputs.spectra.map((s) => ({
                name: s.name,
                experiment: s.experiment,
                spectrumFile: s.original,
                sizeMB: s.sizeMB,
                peakList: s.peakList ? `${s.peakList.original} (${s.peakList.format}, ${s.peakList.peaks} peaks)` : "none: this spectrum is not used in the assignment",
              })),
              shiftList: state.inputs.shiftList?.original,
            }
          : { note: "the assignment of this demo project comes from its bundled peak lists; it cannot be changed here" }),
        attribution: state.attribution?.text,
      };
      return { ok: true, result, summary: `${state.meta.name}: ${state.sequence.length} residues, ${state.spectra.length} spectra` };
    },
  },

  import_pdb: {
    name: "import_pdb",
    description: "Load a protein structure from PDB text or download it from RCSB by 4-character PDB id. Used by the 3D viewer and the structure analyses.",
    input_schema: obj({
      pdbId: { type: "string", description: "4-character PDB id to fetch from RCSB, e.g. 1UBQ" },
      text: { type: "string", description: "PDB-format text (alternative to pdbId)" },
    }),
    async run(state, args, ctx) {
      let text = typeof args.text === "string" ? args.text : "";
      let id = typeof args.pdbId === "string" ? args.pdbId.trim().toUpperCase() : "";
      if (!text) {
        if (!/^[0-9][A-Z0-9]{3}$/.test(id)) return fail("give either PDB text or a valid 4-character pdbId");
        const f = ctx.fetchImpl ?? fetch;
        try {
          const resp = await f(`https://files.rcsb.org/download/${id}.pdb`);
          if (!resp.ok) return fail(`RCSB returned HTTP ${resp.status} for ${id}`);
          text = await resp.text();
        } catch (e) {
          return fail(`could not download ${id}: ${errMsg(e)}`);
        }
      }
      const model = parsePdb(text, id);
      if (!model.atoms.length) return fail("no ATOM records found in the structure");
      if (!id) id = (text.match(/^HEADER.{56}(\w{4})/m)?.[1] ?? "USER").toUpperCase();
      state.pdb = { id, text };
      state.meta.pdbId = id;
      return {
        ok: true,
        changed: true,
        result: { pdbId: id, atoms: model.atoms.length, residues: model.residues.length, helices: model.helices.length, strands: model.sheets.length, title: model.title.slice(0, 160) },
        ui: [{ type: "color_structure", scheme: "confidence" }],
        summary: `Loaded structure ${id} (${model.residues.length} residues)`,
      };
    },
  },

  predict_esmfold_structure: {
    name: "predict_esmfold_structure",
    description:
      "Predict the project's structure from its sequence with ESMFold (the public ESM Metagenomic Atlas API; takes seconds, and sends the sequence to Meta). The model is numbered like the project and carries pLDDT in its B-factors (colour scheme 'bfactor'). Use it when the project has no structure; replace=true swaps an existing one.",
    input_schema: obj({ replace: { type: "boolean", description: "replace the current structure (default false)" } }),
    async run(state, args, ctx) {
      const out = await attachEsmfoldModel(state, { fetchImpl: ctx.fetchImpl, force: args.replace === true });
      if (!out.ok) return { ...fail(out.error), changed: true };
      return {
        ok: true,
        changed: true,
        result: out,
        ui: [{ type: "color_structure", scheme: "confidence" }],
        summary: `Predicted the structure with ESMFold${out.meanPlddt !== undefined ? ` (mean pLDDT ${out.meanPlddt.toFixed(0)})` : ""}`,
      };
    },
  },

  fetch_alphafold_structure: {
    name: "fetch_alphafold_structure",
    description:
      "Load the AlphaFold DB model of the project's sequence as its structure: the model for the project's UniProt accession, or for any UniProt entry with exactly this sequence (looked up by the sequence's checksum, so the sequence is not sent). It is cropped to the project's residues and carries pLDDT in its B-factors (colour scheme 'bfactor'). Use it when the project has no structure; replace=true swaps an existing one.",
    input_schema: obj({ replace: { type: "boolean", description: "replace the current structure (default false)" } }),
    async run(state, args, ctx) {
      const out = await attachAlphafoldModel(state, { fetchImpl: ctx.fetchImpl, force: args.replace === true });
      if (!out.ok) return { ...fail(out.error), changed: true };
      return {
        ok: true,
        changed: true,
        result: out,
        ui: [{ type: "color_structure", scheme: "confidence" }],
        summary: `Loaded AlphaFold DB model ${out.entryId} (UniProt ${out.accession}${out.meanPlddt !== undefined ? `, mean pLDDT ${out.meanPlddt.toFixed(0)}` : ""})`,
      };
    },
  },

  get_spin_system: {
    name: "get_spin_system",
    description:
      "Details of one spin system (the amide of one residue): its peaks in every spectrum with their labels from the peak lists (CA(i), CB(i-1), CO(i), ...), its carbon shifts, its residue, the consistency check (class, conflicts, unusual shifts) and its sequential links. Also shows it in the strip plot.",
    input_schema: obj({ root: { type: "string", description: "spin-system (root) name: the residue number of its amide, e.g. '12'" } }, ["root"]),
    run(state, args) {
      const res = needAssignment(state);
      if (typeof res === "string") return fail(res);
      const root = String(args.root);
      const spin = spinOf(res, root);
      if (!spin) return fail(`no spin system "${root}" (there are ${res.spinSystems.length}, e.g. ${res.spinSystems.slice(0, 5).map((s) => s.root).join(", ")})`);
      const bySpec: Record<string, { name: string; c: number; intensity: number; label: string }[]> = {};
      for (const p of spin.peaks) {
        (bySpec[p.spec] ??= []).push({ name: p.name, c: r2(p.cp)!, intensity: sci(p.inty), label: p.label || "(unexplained)" });
      }
      const resi = residueNumberOf(spin.residue);
      const ui: UiAction[] = [{ type: "select_root", root }, { type: "show_spectrum", view: "strips", root }];
      if (resi !== undefined) ui.push({ type: "focus_residue", residue: resi });
      return {
        ok: true,
        result: {
          root,
          H: r2(spin.h, 3),
          N: r2(spin.n, 2),
          peaks: bySpec,
          shifts: Object.fromEntries(Object.entries(labelShifts(spin)).map(([k, v]) => [k, r2(v)])),
          residue: tagLabel(spin.residue),
          consistency: consistencyText(spin.consistency),
          checks: checks(spin),
          otherIssues: spin.issues.filter((i) => i.kind === "missing" || i.kind === "unexplained").map((i) => i.text),
          links: spin.links.map(([to, carbons, dir]) => ({ to, dir: dir === "f" ? "next residue (i+1)" : "previous residue (i-1)", matchingCarbons: carbons })),
        },
        ui,
        summary: `Spin system ${root} → ${tagLabel(spin.residue)}`,
      };
    },
  },

  get_residue: {
    name: "get_residue",
    description:
      "Everything known about one residue: its spin system and consistency check, its backbone chemical shifts (HN, N, CA, CB, CO), and its secondary structure, burial and neighbours in the structure. Focuses the residue in the viewers.",
    input_schema: obj({ residue: { type: "integer", description: "residue number in the sequence numbering" } }, ["residue"]),
    run(state, args) {
      const resi = Number(args.residue);
      if (!residueExists(state, resi)) return fail(`residue ${resi} is outside ${state.firstResidue}–${state.firstResidue + state.sequence.length - 1}`);
      const resn = state.sequence[resi - state.firstResidue];
      const res = state.results.assignment;
      const rv = res?.residues.find((r) => r.resi === resi);
      const spin = rv?.root && res ? spinOf(res, rv.root) : undefined;
      let structure: Record<string, unknown> | undefined;
      if (state.pdb?.text) {
        const model = modelFor(state.pdb.text, state.pdb.id);
        const nb = structureNeighbours(model, resi, { radius: 6 });
        if (!("error" in nb)) {
          structure = {
            secondaryStructure: { H: "helix", E: "strand", C: "coil" }[nb.ss],
            burialHeavyAtomsWithin10A: nb.burial,
            neighboursWithin6A: nb.neighbours.slice(0, 12).map((n) => `${n.resn}${n.resi} (${n.minDistance} Å)`),
          };
        }
      }
      let assignment: unknown = "no assignment yet";
      if (resn === "P") assignment = "proline: no amide proton, so no spin system in HN-detected spectra";
      else if (rv) {
        assignment = {
          spinSystem: rv.root ?? null,
          consistency: consistencyText(rv.consistency),
          checks: spin ? checks(spin) : undefined,
          shifts: Object.fromEntries(Object.entries(rv.shifts).map(([k, v]) => [k, r2(v, k === "HN" ? 3 : 2)])),
        };
      }
      return {
        ok: true,
        result: { residue: resi, name: resLabel(state, resi), assignment, structure },
        ui: [{ type: "focus_residue", residue: resi }],
        summary: `${resLabel(state, resi)}${rv?.root ? ` ← spin system ${rv.root}` : ""}`,
      };
    },
  },

  list_problems: {
    name: "list_problems",
    description:
      "What deserves a spectroscopist's attention in the assignment: residues with conflicts (peaks of one atom that disagree, shifts implausible for the residue type), unconfirmed residues (no sequential link, or an unusual shift), residues without peaks, peaks no CA/CB/C′ label explains, and peaks the peak lists could not place. Highlights the affected residues.",
    input_schema: obj({ limit: { type: "integer", minimum: 1, maximum: 100, description: "max items per list (default 15)" } }),
    run(state, args) {
      const res = needAssignment(state);
      if (typeof res === "string") return fail(res);
      const limit = typeof args.limit === "number" ? args.limit : 15;
      const describe = (s: SpinSystem) => ({ root: s.root, residue: tagLabel(s.residue), checks: checks(s), linkedTo: s.links.map(([to]) => to) });
      const low = res.spinSystems.filter((s) => s.consistency === "low");
      const high = res.spinSystems.filter((s) => s.consistency === "high");
      const unassigned = res.residues.filter((r) => !r.root && r.resn !== "P" && r.resi !== state.firstResidue).map((r) => r.resi);
      const lowResidues = low.map((s) => residueNumberOf(s.residue)!).filter((x) => x !== undefined);
      const unexplainedPeaks = Object.fromEntries(
        Object.entries(
          res.spinSystems.reduce<Record<string, number>>((acc, s) => {
            for (const p of s.peaks) if (!p.label) acc[p.spec] = (acc[p.spec] ?? 0) + 1;
            return acc;
          }, {}),
        ),
      );
      const highlight = [...lowResidues, ...unassigned];
      return {
        ok: true,
        result: {
          conflicts: low.slice(0, limit).map(describe),
          conflictCount: low.length,
          unconfirmed: high.slice(0, limit).map(describe),
          unconfirmedCount: high.length,
          unassignedResidues: unassigned,
          unexplainedPeaksPerSpectrum: unexplainedPeaks,
          peakListNotes: res.notes.length ? res.notes : undefined,
        },
        ui: highlight.length ? [{ type: "highlight_residues", residues: highlight, color: "#FF7D45", label: "needs attention" }] : [],
        summary: `${low.length} residues with conflicts, ${high.length} unconfirmed, ${unassigned.length} unassigned`,
      };
    },
  },

  explain_assignment: {
    name: "explain_assignment",
    description:
      "Explain how well a residue's assignment holds together: its consistency check (conflicts, unusual shifts), the carbon shifts (CA, CB, C′) that link it to the spin systems on the previous and next residues with their differences in ppm, and peaks no label explains. Give either root or residue.",
    input_schema: obj({ root: { type: "string" }, residue: { type: "integer" } }),
    run(state, args) {
      const res = needAssignment(state);
      if (typeof res === "string") return fail(res);
      let root = typeof args.root === "string" ? args.root : undefined;
      if (!root && typeof args.residue === "number") {
        if (state.sequence[args.residue - state.firstResidue] === "P") {
          return { ok: true, result: { residue: resLabel(state, args.residue), note: "a proline has no amide proton, so no spin system can be placed on it" }, ui: [{ type: "focus_residue", residue: args.residue }], summary: `${resLabel(state, args.residue)} is a proline` };
        }
        root = rootOfResidue(res, args.residue);
        if (!root) return fail(`${resLabel(state, args.residue)} has no assigned spin system`);
      }
      if (!root) return fail("give root or residue");
      const spin = spinOf(res, root);
      if (!spin) return fail(`no spin system "${root}"`);
      const resi = residueNumberOf(spin.residue)!;
      const tol = TOLERANCE.link;
      const mine = labelValues(spin);
      // closest pair of peaks per atom: a spin system can carry more than one peak per label
      const compare = (other: SpinSystem | undefined, mineSuffix: "(i)" | "(i-1)", otherSuffix: "(i)" | "(i-1)") => {
        if (!other) return undefined;
        const theirs = labelValues(other);
        const out: Record<string, { here: number; there: number; deltaPpm: number; withinTolerance: boolean }> = {};
        for (const atom of ["CO", "CA", "CB"]) {
          const as = mine[atom + mineSuffix] ?? [];
          const bs = theirs[atom + otherSuffix] ?? [];
          let best: [number, number] | undefined;
          for (const a of as) for (const b of bs) if (!best || Math.abs(a - b) < Math.abs(best[0] - best[1])) best = [a, b];
          if (best) out[atom] = { here: r2(best[0])!, there: r2(best[1])!, deltaPpm: r2(best[0] - best[1], 3)!, withinTolerance: Math.abs(best[0] - best[1]) <= tol };
        }
        return out;
      };
      const prevRoot = rootOfResidue(res, resi - 1);
      const nextRoot = rootOfResidue(res, resi + 1);
      const prevSpin = prevRoot ? spinOf(res, prevRoot) : undefined;
      const nextSpin = nextRoot ? spinOf(res, nextRoot) : undefined;
      const prevResn = state.sequence[resi - 1 - state.firstResidue];
      const linked = (other: string | undefined, dir: "f" | "b") => spin.links.some(([t, , d]) => t === other && d === dir);
      return {
        ok: true,
        result: {
          root,
          residue: resLabel(state, resi),
          consistency: consistencyText(spin.consistency),
          checks: checks(spin),
          previous:
            prevResn === "P"
              ? `${resLabel(state, resi - 1)} is a proline (no amide): its CA/CB/CO appear only as (i-1) peaks of this spin system`
              : prevSpin
                ? { spinSystem: prevRoot, residue: resLabel(state, resi - 1), linked: linked(prevRoot, "b"), shiftMatch: compare(prevSpin, "(i-1)", "(i)") }
                : resi - 1 >= state.firstResidue
                  ? `${resLabel(state, resi - 1)} has no assigned spin system`
                  : "start of the sequence",
          next: nextSpin
            ? { spinSystem: nextRoot, residue: resLabel(state, resi + 1), linked: linked(nextRoot, "f"), shiftMatch: compare(nextSpin, "(i)", "(i-1)") }
            : residueExists(state, resi + 1)
              ? `${resLabel(state, resi + 1)} has no assigned spin system`
              : "end of the sequence",
          carbonTolerancePpm: tol,
          unexplainedPeaks: unexplained(spin.peaks),
        },
        ui: [{ type: "select_root", root }, { type: "focus_residue", residue: resi }, { type: "show_spectrum", view: "strips", root }],
        summary: `Explained ${root} → ${resLabel(state, resi)} (${CONFIDENCE[spin.consistency].label.toLowerCase()})`,
      };
    },
  },

  export_results: {
    name: "export_results",
    description: `Export the assignment: ${EXPORT_FORMATS.map((f) => `'${f}' (${EXPORT_LABELS[f].hint})`).join(", ")}. Returns a preview; the full file is downloadable from the export buttons.`,
    input_schema: obj({ format: { type: "string", enum: [...EXPORT_FORMATS] } }, ["format"]),
    run(state, args) {
      const res = needAssignment(state);
      if (typeof res === "string") return fail(res);
      try {
        const out = exportResults(args.format as ExportFormat, { result: res, sequence: state.sequence, firstResidue: state.firstResidue, name: state.meta.name });
        const preview = out.text.length > 2500 ? `${out.text.slice(0, 2500)}\n… (${out.text.length - 2500} more characters)` : out.text;
        return { ok: true, result: { filename: out.filename, characters: out.text.length, lines: out.text.split("\n").length, preview, download: `/api/projects/${state.id}/export?format=${args.format}` }, summary: `Exported ${out.filename}` };
      } catch (e) {
        return fail(`export failed: ${errMsg(e)}`);
      }
    },
  },

  structure_neighbors: {
    name: "structure_neighbors",
    description: "Residues (and methyl carbons) within a radius of a residue — or of one of its atoms — in the loaded structure, with closest atom pairs and distances. Highlights them in 3D.",
    input_schema: obj(
      {
        residue: { type: "integer" },
        atom: { type: "string", description: "optional atom name, e.g. CD1" },
        radius: { type: "number", minimum: 2, maximum: 15, description: "Å, default 6" },
      },
      ["residue"],
    ),
    run(state, args) {
      if (!state.pdb?.text) return fail("no structure loaded (use import_pdb)");
      const model = modelFor(state.pdb.text, state.pdb.id);
      const rep = structureNeighbours(model, Number(args.residue), { atom: typeof args.atom === "string" ? args.atom : undefined, radius: typeof args.radius === "number" ? args.radius : 6 });
      if ("error" in rep) return fail(rep.error);
      return {
        ok: true,
        result: {
          residue: `${rep.resn}${rep.residue}`,
          probe: rep.probe,
          radius: rep.radius,
          secondaryStructure: rep.ss,
          burial: rep.burial,
          neighbours: rep.neighbours.slice(0, 25).map((n) => ({ residue: `${n.resn}${n.resi}`, distance: n.minDistance, closest: n.closest, ss: n.ss })),
          neighbourCount: rep.neighbours.length,
          methylNeighbours: rep.methylNeighbours.slice(0, 20).map((m) => `${m.resn}${m.resi} ${m.atom} (${m.distance} Å)`),
        },
        ui: [
          { type: "highlight_residues", residues: rep.neighbours.map((n) => n.resi), color: "#65CBF3", label: `within ${rep.radius} Å of ${rep.resn}${rep.residue}` },
          { type: "focus_residue", residue: rep.residue },
        ],
        summary: `${rep.neighbours.length} residues within ${rep.radius} Å of ${rep.resn}${rep.residue}`,
      };
    },
  },

  secondary_structure_from_shifts: {
    name: "secondary_structure_from_shifts",
    description:
      "Chemical shift index: secondary structure predicted from the assigned CA/CB/CO shifts (deviations from Wishart random-coil values), with helix/strand segments, per-residue secondary shifts and agreement with the PDB structure's HELIX/SHEET records. Colours the structure by secondary structure.",
    input_schema: obj({}),
    run(state) {
      const res = needAssignment(state);
      if (typeof res === "string") return fail(res);
      const model = state.pdb?.text ? modelFor(state.pdb.text, state.pdb.id) : undefined;
      const csi = chemicalShiftIndex(state.sequence, state.firstResidue, residueShiftTable(res), model);
      const fmt = (segs: [number, number][]) => segs.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`));
      const string = csi.residues.map((r) => (r.csi === "?" ? "-" : r.csi)).join("");
      return {
        ok: true,
        result: {
          method: csi.method,
          predictedHelices: fmt(csi.predicted.helix),
          predictedStrands: fmt(csi.predicted.strand),
          pdbHelices: csi.pdb ? fmt(csi.pdb.helix) : undefined,
          pdbStrands: csi.pdb ? fmt(csi.pdb.strand) : undefined,
          agreement: csi.agreement,
          perResidue: string,
          residuesWithShifts: csi.residues.filter((r) => r.score !== undefined).length,
        },
        ui: [{ type: "color_structure", scheme: "secondary" }],
        summary: csi.agreement ? `CSI agrees with the structure for ${csi.agreement.percent}% of residues` : "CSI computed",
      };
    },
  },

  list_artina_proteins: {
    name: "list_artina_proteins",
    description:
      "Browse the ARTINA dataset (nmrdb.ethz.ch; Klukowski et al., ETH Zürich; CC BY 4.0): 100 proteins with real processed 2D–4D NMR spectra, deposited structures and shifts. Filter by text (PDB/BMRB id or words of the reference), residue range and required experiments (HNCO, HNcaCO, HNCA, HNcoCA, CBCANH, CBCAcoNH, N15HSQC). Returns per protein the backbone experiments present, download size (MB) and whether it is cached locally.",
    input_schema: obj({
      query: { type: "string", description: "PDB/BMRB id or text in the reference" },
      minResidues: { type: "integer", minimum: 1 },
      maxResidues: { type: "integer", minimum: 1 },
      needs: { type: "array", items: { type: "string", enum: ["HNCO", "HNcaCO", "HNCA", "HNcoCA", "CBCANH", "CBCAcoNH", "N15HSQC"] }, description: "experiments that must be present" },
      limit: { type: "integer", minimum: 1, maximum: 100, description: "default 25" },
    }),
    async run(_state, args) {
      const { catalogSummaries } = await import("../artina/catalog");
      const q = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
      const needs = (args.needs as string[] | undefined) ?? [];
      let list = catalogSummaries().filter((p) => {
        if (q && ![p.id, p.pdb ?? "", p.bmrb ?? "", p.reference ?? ""].some((x) => x.toLowerCase().includes(q))) return false;
        if (typeof args.minResidues === "number" && p.residues < args.minResidues) return false;
        if (typeof args.maxResidues === "number" && p.residues > args.maxResidues) return false;
        return needs.every((n) => (n === "N15HSQC" ? p.hasHsqc : p.backbone.includes(n)));
      });
      list = list.sort((a, b) => b.backbone.length - a.backbone.length || a.backboneMB - b.backboneMB);
      const total = list.length;
      const limit = typeof args.limit === "number" ? args.limit : 25;
      return {
        ok: true,
        result: {
          dataset: "ARTINA 100-protein NMR spectra dataset (https://nmrdb.ethz.ch/, CC BY 4.0)",
          matches: total,
          proteins: list.slice(0, limit).map((p) => ({
            id: p.id,
            residues: p.residues,
            bmrb: p.bmrb,
            year: p.year,
            backbone: p.backbone,
            hsqc: p.hasHsqc,
            downloadMB: p.backboneMB,
            cached: p.cached,
            reference: p.reference ? p.reference.slice(0, 140) : undefined,
          })),
        },
        summary: `${total} ARTINA proteins match`,
      };
    },
  },

  import_artina_protein: {
    name: "import_artina_protein",
    description:
      "Import an ARTINA protein as a NEW project (the current project is kept): downloads its NMRPipe backbone triple-resonance spectra (HNCO, HN(CA)CO, HNCA, HN(CO)CA, CBCANH, CBCA(CO)NH; typically 80–250 MB, cached after the first import) with their deposited assigned peak lists, and the deposited structure, then creates the project with its assignment built from those peak lists. The app switches to the new project when it exists; waits up to ~90 s for that, otherwise returns a jobId for get_import_status.",
    input_schema: obj(
      {
        id: { type: "string", description: "ARTINA protein id, e.g. 2K50" },
        maxMB: { type: "number", minimum: 10, maximum: 4000, description: "download size limit, default 400" },
        wait: { type: "boolean", description: "wait until the project exists (default true)" },
      },
      ["id"],
    ),
    async run(_state, args) {
      const { startImport, getJob } = await import("../artina/jobs");
      const job = startImport({ id: String(args.id), maxMB: typeof args.maxMB === "number" ? args.maxMB : undefined });
      if (job.status === "error") return fail(job.error ?? "import failed");
      if (args.wait !== false) {
        const end = Date.now() + 90000;
        for (;;) {
          const j = getJob(job.jobId);
          if (!j || j.projectId || j.status === "done" || j.status === "error" || Date.now() >= end) break;
          await new Promise((r) => setTimeout(r, 250));
        }
      }
      return importOutcome(getJob(job.jobId) ?? job);
    },
  },

  get_import_status: {
    name: "get_import_status",
    description:
      "Status of an ARTINA import job (downloading, processing, done or error; progress 0–1; recent log). Once the project exists, returns its summary and switches the app to it.",
    input_schema: obj({ jobId: { type: "string" } }, ["jobId"]),
    async run(_state, args) {
      const { getJob } = await import("../artina/jobs");
      const job = getJob(String(args.jobId));
      if (!job) return fail(`unknown import job ${args.jobId}`);
      return importOutcome(job);
    },
  },

  list_real_spectra: {
    name: "list_real_spectra",
    description:
      "Real processed spectra of the current project (uploaded or imported from ARTINA): name, experiment, the spectrum type it is assigned as, dimensions with nuclei and ppm windows, noise level and size. Use these names with ui_show_spectrum view 'planes'.",
    input_schema: obj({}),
    run(state) {
      const list = state.realSpectra ?? [];
      if (!list.length) return { ok: true, result: { count: 0, note: "this project has no real spectra (upload your own or import an ARTINA protein)" }, summary: "no real spectra" };
      return {
        ok: true,
        result: {
          count: list.length,
          spectra: list.map((r) => ({
            name: r.name,
            experiment: r.experiment,
            assignedAs: r.engineType,
            dims: r.axes.map((a) => `${a.label} ${a.size} pts ${a.ppmMin.toFixed(2)}–${a.ppmMax.toFixed(2)} ppm`),
            noise: sci(r.noise),
            maxSN: r.noise ? Math.round(r.maxAbs / r.noise) : undefined,
            sizeMB: r.sizeMB,
          })),
          attribution: state.attribution?.text,
        },
        summary: `${list.length} real spectra`,
      };
    },
  },

};

async function importOutcome(job: ImportJob): Promise<ActionOutcome> {
  const base = { jobId: job.jobId, protein: job.proteinId, status: job.status, stage: job.stage, progress: +job.progress.toFixed(2), message: job.message };
  if (job.status === "error") return { ...fail(`import of ${job.proteinId} failed: ${job.error}`), result: { ...base, projectId: job.projectId, log: job.log.slice(-8) } };
  if (!job.projectId) {
    return { ok: true, result: { ...base, log: job.log.slice(-5), hint: "still running — call get_import_status with this jobId" }, summary: `Import ${job.proteinId}: ${job.status} ${(job.progress * 100).toFixed(0)}%` };
  }
  const { getProject } = await import("./store");
  const st = getProject(job.projectId);
  const res = st?.results.assignment;
  return {
    ok: true,
    result: {
      ...base,
      projectId: job.projectId,
      protein: st?.meta.name,
      residues: st?.sequence.length,
      spectra: st?.inputs?.spectra.map((s) => ({ name: s.name, experiment: s.experiment, sizeMB: s.sizeMB, peakList: s.peakList?.original ?? null })),
      assignment: res ? res.stats : undefined,
      attribution: st?.attribution?.text,
      note: "The app now shows the new project; further tool calls in this chat still act on the previous project until the user sends a new message.",
    },
    ui: [{ type: "switch_project", projectId: job.projectId }, { type: "show_spectrum", view: "planes" }],
    summary: `Imported ${job.proteinId} as a new project${res ? ` (${res.stats.assigned} residues assigned from the deposited peak lists)` : ""}`,
  };
}

// ----------------------------------------------------------------------------------- UI tools
const VIEWS: SpectrumViewId[] = ["hsqc", "strips", "strips3d", "matrix", "planes"];
const SCHEMES: ColorScheme[] = ["confidence", "secondary", "residue", "hydrophobicity", "bfactor"];
const REPRS: Representation[] = ["cartoon", "cartoon+atoms", "sticks", "spheres"];

interface UiToolImpl extends ToolSpec {
  run: (args: Record<string, unknown>, state: ProjectState) => ActionOutcome;
}

export const UI_TOOLS: UiToolImpl[] = [
  {
    name: "ui_focus_residue",
    description: "Select a residue in every viewer: highlights it in the sequence bar, centres the 3D structure on it and shows its spectra.",
    input_schema: obj({ residue: { type: "integer" } }, ["residue"]),
    run(args, state) {
      const resi = Number(args.residue);
      if (!residueExists(state, resi)) return fail(`residue ${resi} is outside the sequence`);
      return { ok: true, ui: [{ type: "focus_residue", residue: resi }], summary: `Focused ${resLabel(state, resi)}` };
    },
  },
  {
    name: "ui_show_spectrum",
    description:
      "Switch the spectrum panel: 'hsqc' (1H-15N HSQC of the HN roots with assignments), 'strips' (HNCA/HNCACB backbone-walk strips, optionally centred on a root or residue list), 'strips3d' (rotatable 3D cube of a triple-resonance spectrum: HSQC floor, carbon peaks on stems above each amide, movable slice plane, sequential links; give experiment = spectrum type such as hnca or hncacb, optional root to highlight), 'matrix' (residue × residue sequential-link matrix), 'planes' (planes of the project's real 2D/3D spectra: give experiment = real spectrum name, optional at = ppm of the plane).",
    input_schema: obj(
      {
        view: { type: "string", enum: VIEWS },
        root: { type: "string" },
        experiment: { type: "string" },
        residues: { type: "array", items: { type: "integer" } },
        at: { type: "number", description: "ppm of the plane (planes view, 3D spectra)" },
      },
      ["view"],
    ),
    run(args) {
      const a: UiAction = { type: "show_spectrum", view: args.view as SpectrumViewId };
      if (typeof args.root === "string") a.root = args.root;
      if (typeof args.experiment === "string") a.experiment = args.experiment;
      if (typeof args.at === "number") a.at = args.at;
      if (Array.isArray(args.residues)) a.residues = args.residues as number[];
      return { ok: true, ui: [a], summary: `Showing ${args.view}` };
    },
  },
  {
    name: "ui_highlight_residues",
    description: "Highlight a set of residues in the sequence bar and 3D structure (e.g. residues you are discussing). Optional hex color and label.",
    input_schema: obj(
      {
        residues: { type: "array", items: { type: "integer" }, minItems: 1 },
        color: { type: "string", description: "hex colour, e.g. #FF7D45" },
        label: { type: "string" },
      },
      ["residues"],
    ),
    run(args) {
      const a: UiAction = { type: "highlight_residues", residues: args.residues as number[] };
      if (typeof args.color === "string" && /^#[0-9a-fA-F]{6}$/.test(args.color)) a.color = args.color;
      if (typeof args.label === "string") a.label = args.label;
      return { ok: true, ui: [a], summary: `Highlighted ${(args.residues as number[]).length} residues` };
    },
  },
  {
    name: "ui_clear_highlights",
    description: "Remove residue highlights from the viewers.",
    input_schema: obj({}),
    run() {
      return { ok: true, ui: [{ type: "clear_highlights" }], summary: "Cleared highlights" };
    },
  },
  {
    name: "ui_color_structure",
    description: "Colour the 3D structure and sequence: confidence (assignment), secondary, residue (type), hydrophobicity, bfactor.",
    input_schema: obj({ scheme: { type: "string", enum: SCHEMES } }, ["scheme"]),
    run(args) {
      return { ok: true, ui: [{ type: "color_structure", scheme: args.scheme as ColorScheme }], summary: `Colouring by ${args.scheme}` };
    },
  },
  {
    name: "ui_set_representation",
    description: "Change the 3D representation: cartoon, cartoon+atoms, sticks, spheres.",
    input_schema: obj({ representation: { type: "string", enum: REPRS } }, ["representation"]),
    run(args) {
      return { ok: true, ui: [{ type: "set_representation", representation: args.representation as Representation }], summary: `Representation: ${args.representation}` };
    },
  },
];

// ----------------------------------------------------------------------------------- exports
export const ACTION_SPECS: Record<ActionName, ToolSpec> = Object.fromEntries(
  ACTION_NAMES.map((n) => [n, { name: ACTIONS[n].name, description: ACTIONS[n].description, input_schema: ACTIONS[n].input_schema }]),
) as Record<ActionName, ToolSpec>;

/** All tools offered to the agent, in a stable order (stable bytes keep the prompt cache warm). */
export function agentToolSpecs(): ToolSpec[] {
  return [...ACTION_NAMES.map((n) => ACTION_SPECS[n]), ...UI_TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }))];
}

export function isActionName(name: string): name is ActionName {
  return (ACTION_NAMES as readonly string[]).includes(name);
}

export function isUiTool(name: string): boolean {
  return UI_TOOLS.some((t) => t.name === name);
}

/** Run an action (validating its args). Mutates `state`; the caller persists when `changed`. */
export async function runAction(state: ProjectState, name: string, args: Record<string, unknown> = {}, ctx: ActionContext = { actor: "user" }): Promise<ActionOutcome> {
  const ui = UI_TOOLS.find((t) => t.name === name);
  const impl = isActionName(name) ? ACTIONS[name] : undefined;
  const spec = impl ?? ui;
  if (!spec) return fail(`unknown action "${name}"`);
  const err = validateArgs(spec.input_schema, args ?? {});
  if (err) return fail(`invalid arguments: ${err}`);
  try {
    if (ui) return ui.run(args, state);
    return await impl!.run(state, args, ctx);
  } catch (e) {
    return fail(`${name} failed: ${errMsg(e)}`);
  }
}

/** Serialise a result for a tool_result block, capped in size. */
export function compactForModel(outcome: ActionOutcome, limit = 12000): string {
  const body = outcome.ok ? { ok: true, result: outcome.result ?? outcome.summary } : { ok: false, error: outcome.error };
  let text = JSON.stringify(body);
  if (text.length > limit) text = `${text.slice(0, limit)}… [truncated ${text.length - limit} characters]`;
  return text;
}
