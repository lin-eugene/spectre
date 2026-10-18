// Export of an assignment: NMR-STAR 3.1 assigned chemical shifts, a TALOS-style shift table, the
// spin systems with their consistency check, the assigned peaks per experiment (Sparky format) and
// a tab-separated shift table.
import type { AssignmentResult, Consistency } from "./assignment";
import { CONFIDENCE } from "./contract";
import { P1TO3 } from "./residues";

export const EXPORT_FORMATS = ["nmrstar", "bmrb_tab", "assignment_list", "peaklists", "shifts"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_LABELS: Record<ExportFormat, { label: string; hint: string }> = {
  nmrstar: { label: "NMR-STAR", hint: "assigned_chem_shift_list (BMRB deposition)" },
  bmrb_tab: { label: "BMRB .tab", hint: "TALOS-style shift table" },
  assignment_list: { label: "Assignment list", hint: "spin system → residue, with its consistency check" },
  peaklists: { label: "Peak lists", hint: "assigned peaks per experiment (Sparky format)" },
  shifts: { label: "Shifts table", hint: "residue, atom, shift and consistency (tab-separated)" },
};

export function isExportFormat(x: unknown): x is ExportFormat {
  return typeof x === "string" && (EXPORT_FORMATS as readonly string[]).includes(x);
}

export interface ExportContext {
  result: AssignmentResult;
  sequence: string;
  firstResidue: number;
  name: string;
}

const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || "project";
const padL = (s: string | number, n: number) => String(s).padStart(n);
const ATOM_ORDER = ["HN", "N", "CO", "CA", "CB"];
/** NMR-STAR / BMRB atom names */
const starAtom = (a: string) => (a === "HN" ? "H" : a === "CO" ? "C" : a);

function residueOf(ctx: ExportContext, resi: number): string {
  return ctx.sequence[resi - ctx.firstResidue] ?? "X";
}

/** Residues with shifts, ascending, with their atoms in display order. */
function shiftRows(ctx: ExportContext): { resi: number; consistency?: Consistency; atoms: [string, number][] }[] {
  return ctx.result.residues
    .filter((r) => Object.keys(r.shifts).length)
    .sort((a, b) => a.resi - b.resi)
    .map((r) => {
      const rest = Object.keys(r.shifts)
        .filter((a) => !ATOM_ORDER.includes(a))
        .sort();
      const atoms = [...ATOM_ORDER.filter((a) => a in r.shifts), ...rest].map((a) => [a, r.shifts[a]] as [string, number]);
      return { resi: r.resi, consistency: r.consistency, atoms };
    });
}

function nmrStar(ctx: ExportContext): string {
  const lines: string[] = [];
  lines.push(`data_${slug(ctx.name)}`);
  lines.push("");
  lines.push(`# ${ctx.name}: backbone assignment from assigned peak lists, exported by Spectre`);
  lines.push(`# Entity sequence (first residue ${ctx.firstResidue}, ${ctx.sequence.length} residues):`);
  for (let i = 0; i < ctx.sequence.length; i += 60) lines.push(`#   ${ctx.sequence.slice(i, i + 60)}`);
  lines.push("");
  lines.push("save_assigned_chem_shift_list_1");
  lines.push("   _Assigned_chem_shift_list.Sf_category                 assigned_chemical_shifts");
  lines.push("   _Assigned_chem_shift_list.Sf_framecode                assigned_chem_shift_list_1");
  lines.push("   _Assigned_chem_shift_list.ID                          1");
  lines.push("   _Assigned_chem_shift_list.Chem_shift_reference_label  .");
  lines.push("   _Assigned_chem_shift_list.Details                     'Backbone shifts: means over the assigned peaks of each atom'");
  lines.push("");
  lines.push("   loop_");
  for (const tag of [
    "ID",
    "Entity_assembly_ID",
    "Entity_ID",
    "Comp_index_ID",
    "Seq_ID",
    "Comp_ID",
    "Atom_ID",
    "Atom_type",
    "Atom_isotope_number",
    "Val",
    "Val_err",
    "Ambiguity_code",
    "Assigned_chem_shift_list_ID",
  ]) {
    lines.push(`      _Atom_chem_shift.${tag}`);
  }
  lines.push("");
  let id = 0;
  for (const row of shiftRows(ctx)) {
    const comp = P1TO3[residueOf(ctx, row.resi)] ?? "UNK";
    for (const [a, v] of row.atoms) {
      const atom = starAtom(a);
      const type = atom[0];
      const iso = type === "H" ? 1 : type === "C" ? 13 : type === "N" ? 15 : ".";
      id++;
      lines.push(
        `      ${padL(id, 5)} 1 1 ${padL(row.resi, 4)} ${padL(row.resi, 4)} ${comp.padEnd(3)} ${atom.padEnd(4)} ${type} ${padL(iso, 2)} ${padL(v.toFixed(3), 8)} . 1 1`,
      );
    }
  }
  lines.push("   stop_");
  lines.push("");
  lines.push("save_");
  lines.push("");
  return lines.join("\n");
}

/** Sparky list of the assigned peaks: w1 = 13C, w2 = 15N, w3 = 1H. */
function sparky(ctx: ExportContext): string {
  const head = `${"Assignment".padStart(20)}${"w1".padStart(11)}${"w2".padStart(11)}${"w3".padStart(11)}${"Data Height".padStart(14)}\n\n`;
  const specs = [...new Set(ctx.result.spinSystems.flatMap((s) => s.peaks.map((p) => p.spec)))];
  let out = "";
  for (const spec of specs) {
    out += `# ${spec}\n` + head;
    for (const ss of ctx.result.spinSystems) {
      const atom = ss.residue;
      if (!atom) continue;
      const resi = parseInt(atom, 10);
      const resn = atom.slice(String(resi).length);
      for (const p of ss.peaks) {
        if (p.spec !== spec || !p.label) continue;
        const m = p.label.match(/^([A-Z]+)\((i|i-1)\)$/);
        if (!m) continue;
        const nucl = m[1] === "CO" ? "C" : m[1];
        const r = m[2] === "i" ? resi : resi - 1;
        const label = r === resi ? `${resn}${resi}${nucl}-N-H` : `${residueOf(ctx, r)}${r}${nucl}-${resn}${resi}N-H`;
        out += `${label.padStart(20)}${p.cp.toFixed(3).padStart(11)}${p.n.toFixed(3).padStart(11)}${p.h.toFixed(3).padStart(11)}${p.inty.toExponential(2).padStart(14)}\n`;
      }
    }
    out += "\n";
  }
  return out;
}

/** TALOS-style table: the sequence, then one line per residue and atom (HN, N, CA, CB, C). */
function talosTab(ctx: ExportContext): string {
  const lines = [`REMARK ${ctx.name}: backbone assignment from assigned peak lists, exported by Spectre`, "", `DATA FIRST_RESID ${ctx.firstResidue}`, ""];
  for (let i = 0; i < ctx.sequence.length; i += 50) {
    const chunk = ctx.sequence.slice(i, i + 50);
    lines.push(`DATA SEQUENCE ${(chunk.match(/.{1,10}/g) ?? []).join(" ")}`);
  }
  lines.push("", "VARS   RESID RESNAME ATOMNAME SHIFT", "FORMAT %4d   %1s     %4s      %8.3f", "");
  const talosAtom: Record<string, string> = { HN: "HN", N: "N", CA: "CA", CB: "CB", CO: "C" };
  for (const row of shiftRows(ctx)) {
    for (const [a, v] of row.atoms) {
      const atom = talosAtom[a];
      if (atom) lines.push(`${padL(row.resi, 4)}   ${residueOf(ctx, row.resi)}     ${atom.padEnd(4)}      ${padL(v.toFixed(3), 8)}`);
    }
  }
  return lines.join("\n") + "\n";
}

const consistencyText = (c: Consistency | undefined) => (c ? CONFIDENCE[c].label.toLowerCase() : "");

function shiftsTable(ctx: ExportContext): string {
  let out = "residue\ttype\tatom\tshift\tconsistency\n";
  for (const row of shiftRows(ctx)) {
    const comp = P1TO3[residueOf(ctx, row.resi)] ?? "UNK";
    for (const [a, v] of row.atoms) out += `${row.resi}\t${comp}\t${starAtom(a)}\t${v.toFixed(3)}\t${consistencyText(row.consistency)}\n`;
  }
  return out;
}

function spinSystemsTable(ctx: ExportContext): string {
  let out = "root\tH\tN\tresidue\tconsistency\tlinked to\tissues\n";
  for (const ss of ctx.result.spinSystems) {
    const r = `${ss.residue.slice(-1)}${parseInt(ss.residue, 10)}`;
    const linked = ss.links.map(([to]) => to).join(" ");
    const issues = ss.issues.filter((i) => i.kind === "conflict" || i.kind === "unusual").map((i) => i.text.replace(/\t/g, " ")).join("; ");
    out += `${ss.root}\t${ss.h.toFixed(3)}\t${ss.n.toFixed(2)}\t${r}\t${consistencyText(ss.consistency)}\t${linked}\t${issues}\n`;
  }
  return out;
}

export function exportResults(format: ExportFormat, ctx: ExportContext): { filename: string; text: string } {
  const base = slug(ctx.name);
  switch (format) {
    case "nmrstar":
      return { filename: `${base}_assigned_shifts.str`, text: nmrStar(ctx) };
    case "bmrb_tab":
      return { filename: `${base}_shifts.tab`, text: talosTab(ctx) };
    case "assignment_list":
      return { filename: `${base}_assignment.tsv`, text: spinSystemsTable(ctx) };
    case "peaklists":
      return { filename: `${base}_assigned_peaks.list`, text: sparky(ctx) };
    case "shifts":
      return { filename: `${base}_shifts.tsv`, text: shiftsTable(ctx) };
  }
  throw new Error(`unknown export format: ${format as string}`);
}
