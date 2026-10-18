import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { ACTION_NAMES } from "@/lib/contract";
import { EXPORT_FORMATS } from "@/lib/export";
import { ACTION_SPECS, agentToolSpecs, compactForModel, runAction, UI_TOOLS, validateArgs } from "@/lib/project/actions";
import { loadUbiquitinDemo } from "@/lib/project/demo";
import { createProject, getProject, listProjects, withProject } from "@/lib/project/store";
import { toProjectView } from "@/lib/project/view";
import type { ProjectState } from "@/lib/project/types";

/** The ubiquitin demo: assigned peak lists written from the BMRB 6457 shifts. */
function freshState(): ProjectState {
  const s = loadUbiquitinDemo();
  s.id = randomUUID();
  return s;
}

beforeAll(() => {
  process.env.SPECTRE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "spectre-actions-"));
});

describe("action specs", () => {
  it("covers every contract action with a schema and description", () => {
    for (const n of ACTION_NAMES) {
      const spec = ACTION_SPECS[n];
      expect(spec.name).toBe(n);
      expect(spec.description.length).toBeGreaterThan(40);
      expect(spec.input_schema.type).toBe("object");
    }
    const names = agentToolSpecs().map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBe(ACTION_NAMES.length + UI_TOOLS.length);
    // the assignment is the user's peak lists: nothing runs, nothing edits it
    for (const gone of ["run_assignment", "set_parameters", "add_manual_adjustment", "fix_assignment", "edit_edge", "import_peak_list", "pick_peaks_real"]) expect(names).not.toContain(gone);
  });

  it("validates arguments", () => {
    expect(validateArgs(ACTION_SPECS.get_residue.input_schema, {})).toMatch(/residue is required/);
    expect(validateArgs(ACTION_SPECS.get_residue.input_schema, { residue: "x" })).toMatch(/must be a number/);
    expect(validateArgs(ACTION_SPECS.get_residue.input_schema, { residue: 3, bogus: 1 })).toMatch(/not a known argument/);
    expect(validateArgs(ACTION_SPECS.get_residue.input_schema, { residue: 3 })).toBeNull();
    expect(validateArgs(ACTION_SPECS.export_results.input_schema, { format: "xml" })).toMatch(/must be one of/);
    expect(validateArgs(ACTION_SPECS.export_results.input_schema, { format: "bmrb_tab" })).toBeNull();
  });
});

describe("actions on the ubiquitin demo", () => {
  const sizes: Record<string, number> = {};
  const run = async (state: ProjectState, name: string, args: Record<string, unknown> = {}) => {
    const o = await runAction(state, name, args, { actor: "agent" });
    sizes[name] = Math.max(sizes[name] ?? 0, compactForModel(o).length);
    return o;
  };

  it("read-only actions", async () => {
    const s = freshState();
    const sum = await run(s, "get_project_summary");
    expect(sum.ok).toBe(true);
    const summary = sum.result as { residues: number; assignment: { source: string; stats: { assigned: number }; peakLists: { experiment: string; used: number }[] } };
    expect(summary.residues).toBe(76);
    expect(summary.assignment.source).toMatch(/peak lists/);
    expect(summary.assignment.stats.assigned).toBe(69);
    expect(summary.assignment.peakLists.map((l) => l.experiment)).toEqual(["HNCA", "HNCACB", "HNCO", "HN(CA)CO"]);

    const res = s.results.assignment!;
    const root = res.spinSystems.find((x) => x.residue)!.root;
    const spin = await run(s, "get_spin_system", { root });
    expect(spin.ok).toBe(true);
    expect(spin.ui?.some((u) => u.type === "select_root")).toBe(true);
    const spinResult = spin.result as { residue: string; consistency: string; peaks: Record<string, { label: string }[]> };
    expect(spinResult.residue).toMatch(/^[A-Z]{3} \d+$/);
    expect(spinResult.consistency).toMatch(/^(confirmed|unconfirmed|conflict)/);
    expect(Object.values(spinResult.peaks).flat().some((p) => p.label === "CA(i)")).toBe(true);
    expect((await run(s, "get_spin_system", { root: "nope" })).ok).toBe(false);

    const r = await run(s, "get_residue", { residue: 23 });
    expect(r.ok).toBe(true);
    expect(r.ui).toEqual([{ type: "focus_residue", residue: 23 }]);
    expect(JSON.stringify(r.result)).toContain("helix");
    expect(JSON.stringify(r.result)).toContain("consistency");
    expect((await run(s, "get_residue", { residue: 999 })).ok).toBe(false);
    expect(JSON.stringify((await run(s, "get_residue", { residue: 19 })).result)).toContain("proline");

    const probs = await run(s, "list_problems");
    expect(probs.ok).toBe(true);
    const problems = probs.result as { unassignedResidues: number[]; conflictCount: number };
    // the three exchange-broadened amides of the demo have no peaks; its lists hold no conflicts
    for (const resi of [24, 53, 62]) expect(problems.unassignedResidues).toContain(resi);
    expect(problems.conflictCount).toBe(0);

    const ex = await run(s, "explain_assignment", { root });
    expect(ex.ok).toBe(true);
    const ex2 = await run(s, "explain_assignment", { residue: 30 });
    expect(ex2.ok).toBe(true);
    expect(JSON.stringify(ex2.result)).toMatch(/shiftMatch/);
    expect((await run(s, "explain_assignment", { residue: 24 })).ok).toBe(false);
    expect(JSON.stringify((await run(s, "explain_assignment", { residue: 19 })).result)).toContain("proline");

    const nb = await run(s, "structure_neighbors", { residue: 44, radius: 7 });
    expect(nb.ok).toBe(true);
    expect((nb.result as { neighbourCount: number }).neighbourCount).toBeGreaterThan(3);
    expect((await run(s, "structure_neighbors", { residue: 44, atom: "ZZ9" })).ok).toBe(false);

    const csi = await run(s, "secondary_structure_from_shifts");
    expect(csi.ok).toBe(true);
    expect((csi.result as { agreement: { percent: number } }).agreement.percent).toBeGreaterThan(70);

    // raw Bruker data is not bundled: the processing actions run on B81434 when it is in the local
    // Bruker directory
    const bl = await run(s, "list_bruker_experiments");
    expect(bl.ok).toBe(true);
    const bruker = (bl.result as { experiments: { experiment: string }[] }).experiments.some((e) => e.experiment === "B81434");

    for (const format of EXPORT_FORMATS) {
      const out = await run(s, "export_results", { format });
      expect(out.ok, format).toBe(true);
    }
    const star = (await run(s, "export_results", { format: "nmrstar" })).result as { preview: string };
    expect(star.preview).toContain("_Atom_chem_shift.Val");
    expect(star.preview).toContain("assigned peak lists");

    expect((await run(s, "process_bruker_1d", { experiment: "B81434", phase: "procs" })).ok).toBe(bruker);
    expect((await run(s, "deconvolve_1d", { experiment: "B81434", region: [7.6, 7.2], maxComponents: 6 })).ok).toBe(bruker);
    expect((await run(s, "process_bruker_1d", { experiment: "../etc" })).ok).toBe(false);
    expect((await run(s, "list_real_spectra")).ok).toBe(true);
  });

  it("changing actions", async () => {
    const s = freshState();
    const pdb = await run(s, "import_pdb", { text: s.pdb!.text, pdbId: "1UBQ" });
    expect(pdb.ok).toBe(true);
    expect(pdb.changed).toBe(true);
    expect((await run(s, "import_pdb", { pdbId: "nope" })).ok).toBe(false);
    for (const gone of ["run_assignment", "set_parameters", "load_demo", "import_peak_list"]) expect((await run(s, gone, {})).ok).toBe(false);
  });

  it("UI tools emit UiActions", async () => {
    const s = freshState();
    expect((await run(s, "ui_focus_residue", { residue: 10 })).ui).toEqual([{ type: "focus_residue", residue: 10 }]);
    expect((await run(s, "ui_show_spectrum", { view: "strips", root: "3" })).ui?.[0]).toMatchObject({ type: "show_spectrum", view: "strips", root: "3" });
    expect((await run(s, "ui_highlight_residues", { residues: [1, 2], color: "#123456" })).ui?.[0]).toMatchObject({ residues: [1, 2], color: "#123456" });
    expect((await run(s, "ui_color_structure", { scheme: "secondary" })).ok).toBe(true);
    expect((await run(s, "ui_set_representation", { representation: "spheres" })).ok).toBe(true);
    expect((await run(s, "ui_set_representation", { representation: "methyls" })).ok).toBe(false);
    expect((await run(s, "ui_color_structure", { scheme: "methyl" })).ok).toBe(false);
    expect((await run(s, "ui_show_spectrum", { view: "methyl" })).ok).toBe(false);
  });

  it("keeps tool results compact", () => {
    for (const [name, size] of Object.entries(sizes)) expect(size, name).toBeLessThan(12100);
  });
});

describe("store", () => {
  it("creates, persists and reloads projects", async () => {
    const s = createProject();
    expect(getProject(s.id)).toBe(s);
    const file = path.join(process.env.SPECTRE_DATA_DIR!, "projects", `${s.id}.json`);
    expect(fs.existsSync(file)).toBe(true);
    const view = toProjectView(s);
    expect(view.assignment?.source).toBe("peaklists");
    expect(view.assignment?.stats.assigned).toBeGreaterThan(60);
    expect(listProjects().some((p) => p.id === s.id)).toBe(true);
    // serialised mutations
    const order: number[] = [];
    await Promise.all([
      withProject(s.id, async () => {
        await new Promise((r) => setTimeout(r, 20));
        order.push(1);
      }),
      withProject(s.id, () => {
        order.push(2);
      }),
    ]);
    expect(order).toEqual([1, 2]);
    expect(await withProject("00000000-0000-0000-0000-000000000000", () => 1)).toBeNull();
    expect(getProject("../../etc/passwd")).toBeNull();
  });

  it("keeps projects of former engines on disk but does not offer them", () => {
    const id = randomUUID();
    const file = path.join(process.env.SPECTRE_DATA_DIR!, "projects", `${id}.json`);
    const old = {
      version: 1,
      id,
      createdAt: "2026-10-17T10:00:00.000Z",
      updatedAt: "2026-10-17T10:00:00.000Z",
      meta: { name: "Old ubiquitin", source: "demo:ubiquitin" },
      sequence: "MQIFV",
      firstResidue: 1,
      spectra: [{ tp: "hnca", ref: "0", f1180: "n", peaks: [] }],
      hsqc: [],
      params: { tolHNCA: 0.4 },
      manual: ["remove,hnca,1,1_2"],
      edges: { add: [], remove: [] },
      guess: {},
      methyl: { peaks: [], noes: [], params: {} },
      results: { assignment: { ok: true, rounds: 1, spinSystems: [], residues: [], stats: { great: 1 } } },
      history: [],
    };
    fs.writeFileSync(file, JSON.stringify(old));
    expect(getProject(id)).toBeNull();
    expect(listProjects().some((p) => p.id === id)).toBe(false);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(old);
    // a project assigned by the former autoAssign engine
    const id2 = randomUUID();
    const engine = {
      ...old,
      id: id2,
      autoassign: { spectra: [], sequenceFile: "sequence.fasta", run: { jobId: "x", status: "done", startedAt: "2026-10-17T10:00:00.000Z", options: { search: false } } },
      results: { assignment: { engine: "autoassign", version: 3, spinSystems: [], residues: [], stats: {} } },
    };
    fs.writeFileSync(path.join(process.env.SPECTRE_DATA_DIR!, "projects", `${id2}.json`), JSON.stringify(engine));
    expect(getProject(id2)).toBeNull();
    expect(listProjects().some((p) => p.id === id2)).toBe(false);
  });
});
