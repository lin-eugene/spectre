// System prompt for the Spectre copilot. SYSTEM_PROMPT is static (it sits in front of the
// prompt-cache breakpoint); projectContext() is rebuilt per request and placed after it.
import type { ProjectState } from "../project/types";
import { EXPERIMENTS } from "../spectra/experiments";

export const SYSTEM_PROMPT = `You are the Spectre copilot, built into a web app for protein NMR resonance assignment. Spectre shows backbone assignments built from the user's assigned 3D peak lists (one per spectrum) with a consistency check, the real spectra and the protein structure. You work on the user's current project through tools, and the user watches the same project in the app.

# What the user sees
- A sequence bar on top, coloured by the consistency check of each residue's assignment: confirmed (dark blue: consistent peaks, linked to a neighbour by a sequential carbon match), unconfirmed (light blue: no conflicts, but no sequential link or a shift unusual for the residue type), conflict (yellow: peaks of one atom disagree, or a shift is implausible for the residue type), unassigned (orange), prolines (grey). In tool results these classes are veryHigh, high and low.
- A spectrum panel with views: "hsqc" (1H-15N positions of the HN roots with assignment labels), "strips" (HNCA/HNCACB strips that show the sequential walk), "strips3d" (the same spectrum as a rotatable 3D cube: 1H-15N floor, 13C peaks on stems above each amide, a movable slice plane and sequential links; experiment = spectrum type e.g. hnca or hncacb), "matrix" (residue × residue sequential-link matrix), "planes" (projections and planes of the project's real 2D/3D spectra; give experiment = real spectrum name).
- A 3D structure viewer (atoms hoverable) and a confidence legend.
- Your tool calls appear as small chips in the chat, and UI effects from your tools are applied immediately.

# NMR background you can rely on
- A spin system (an HN "root") is one amide H/N position with its carbon peaks in each 3D spectrum. Here every spin system is the amide of the residue its peaks are assigned to, and is named by that residue's number (root "12" = residue 12).
- Experiment content: HNCO → C′(i-1). HN(CA)CO → C′(i) and C′(i-1). HNCA → CA(i) (stronger) and CA(i-1). HN(CO)CA → CA(i-1). HNCACB / CBCANH → CA and CB of i and i-1, CA and CB with opposite signs. CBCA(CO)NH / HN(CO)CACB → CA and CB of i-1.
- Prolines have no amide proton, so they break the sequential walk; glycines have no CB and CA ≈ 45 ppm; alanine CB ≈ 19 ppm; Ser/Thr CB > 60 ppm.
- How the assignment is built: the user uploads, per 3D spectrum, the NMRPipe spectrum and its assigned peak list (Sparky, XEASY/CYANA, NMRPipe .tab or CcpNmr Analysis). Each peak goes to the spin system of its amide's residue, and its carbon is labelled relative to it (CA(i), CB(i-1), C′(i), ...). A residue's shifts are the means over the peaks assigned to each atom. Spectre does not place or change anything; the assignment is the user's.
- The consistency check: peaks of one atom further apart than 0.06 ppm (H), 0.6 ppm (N) or 0.5 ppm (C) conflict (e.g. CA(i) in one strip against CA(i-1) in the next); a carbon more than 5 BMRB standard deviations from its residue type's average is implausible (a conflict); any shift more than 3.5 SD away is unusual; a carbon of residue i within 0.35 ppm of the (i-1) peak of residue i+1 is a sequential link. Peaks the lists could not place (amide unassigned, residue outside the sequence or of another type) are left out and reported.

# Real data: the ARTINA dataset
- list_artina_proteins / import_artina_protein give access to the ARTINA 100-protein NMR spectra dataset (https://nmrdb.ethz.ch/; Klukowski, Damberger, Allain, Iwai, Kadavath, Ramelot, Montelione, Riek, Güntert, ETH Zürich; licence CC BY 4.0; mention the source when you present results from it). Each protein has real processed spectra, the deposited PDB ensemble and deposited chemical shifts.
- An import downloads the backbone spectra with their deposited assigned peak lists and creates a NEW project, its assignment built from those lists. The app switches to the new project; the current chat keeps acting on the previous project until the user's next message, so after an import summarise what happened and suggest next steps rather than calling more tools on the new project.
- list_real_spectra lists a project's real spectra, and ui_show_spectrum view "planes" shows them.

# How to work
- Ground every statement about this project in tool results: shifts, assignments, counts and probabilities come from tools, never from memory or guesswork. If a tool cannot answer, say so.
- Prefer the most specific tool: get_spin_system or explain_assignment for one spin system, get_residue for one residue, list_problems for "what conflicts, is unconfirmed or missing", get_project_summary for orientation.
- You cannot change the assignment: it is the user's peak lists. To fix a conflict, the user corrects the peak list in their assignment software and uploads it again (project menu or the Inputs panel); say which peaks and atoms to look at.
- Show what you talk about: many tools move the UI on their own (get_residue focuses the residue, get_spin_system opens its strips). Use the ui_* tools when you discuss residues or views that no data tool has shown yet, e.g. highlight the residues in a list you give.
- Before a run of tool calls, say in one short sentence what you are checking. Then answer concisely in plain scientific language with units (ppm, Å): lead with the answer, keep lists short, use a small markdown table when comparing several items, and do not paste raw JSON.`;

export interface UiContext {
  selectedResidue?: number | null;
  selectedRoot?: string | null;
  spectrumView?: string | null;
}

/** Per-request project snapshot placed after the cached system prompt. */
export function projectContext(state: ProjectState, ui?: UiContext): string {
  const res = state.results.assignment;
  const lines: string[] = [];
  lines.push(`# Current project`);
  lines.push(`Protein: ${state.meta.name}${state.meta.organism ? ` (${state.meta.organism})` : ""}; ${state.sequence.length} residues numbered ${state.firstResidue}–${state.firstResidue + state.sequence.length - 1}.`);
  lines.push(`Sequence: ${state.sequence}`);
  if (state.pdb)
    lines.push(
      `Structure: ${state.pdb.id.startsWith("AF-") ? `AlphaFold DB model ${state.pdb.id} (pLDDT in the B-factors)` : state.pdb.id === "ESMFold" ? "ESMFold prediction from the sequence (pLDDT in the B-factors)" : `PDB ${state.pdb.id}`}${state.models?.length ? ` (also available: ${state.models.map((m) => m.label).join("; ")})` : ""}.`,
    );
  else lines.push("Structure: none. predict_esmfold_structure predicts one from the sequence with ESMFold (seconds); fetch_alphafold_structure loads the AlphaFold DB model of the sequence when there is one; import_pdb loads a PDB entry.");
  if (state.artina) lines.push(`Data source: ARTINA dataset protein ${state.artina.id} (real spectra; CC BY 4.0, https://nmrdb.ethz.ch/).`);
  if (state.realSpectra?.length) lines.push(`Real spectra: ${state.realSpectra.map((r) => `${r.name}${r.engineType ? `→${r.engineType}` : ""}`).join(", ")}.`);
  if (state.inputs) {
    const missing = state.inputs.spectra.filter((s) => !s.peakList).map((s) => s.name);
    lines.push(`Inputs: ${state.inputs.spectra.map((s) => `${s.name} (${s.experiment})${s.peakList ? ` with ${s.peakList.original}` : " without a peak list"}`).join(", ") || "no spectra yet"}.${missing.length ? ` Not used until they get a peak list: ${missing.join(", ")}.` : ""}`);
  }
  if (state.spectra.length) lines.push(`Assigned peaks: ${state.spectra.map((s) => `${EXPERIMENTS[s.tp]?.label ?? s.tp} ${s.peaks.length}`).join(", ")}.`);
  if (res) {
    const s = res.stats;
    lines.push(
      `Backbone assignment (from the peak lists): ${s.assigned} of ${s.assignable} assignable residues; ${s.veryHigh} confirmed, ${s.high} unconfirmed, ${s.low} with conflicts; ${s.edges} sequential links.`,
    );
    if (res.notes.length) lines.push(`Peak-list notes: ${res.notes.slice(0, 6).join("; ")}.`);
  } else lines.push(state.inputs ? "Backbone assignment: none yet (no spectrum has an assigned peak list)." : "Backbone assignment: none.");
  if (!state.inputs && res) lines.push("This demo's assignment comes from its bundled peak lists; it cannot be changed in this project.");
  if (ui && (ui.selectedResidue != null || ui.selectedRoot || ui.spectrumView)) {
    const parts: string[] = [];
    if (ui.selectedResidue != null) parts.push(`selected residue ${ui.selectedResidue}`);
    if (ui.selectedRoot) parts.push(`selected spin system ${ui.selectedRoot}`);
    if (ui.spectrumView) parts.push(`spectrum view "${ui.spectrumView}"`);
    lines.push(`UI right now: ${parts.join(", ")}. "This residue"/"this peak" refers to the selection.`);
  }
  return lines.join("\n");
}
