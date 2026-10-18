// ESMFold predictions for projects that come without a structure, from the ESM Metagenomic Atlas
// API: the sequence is POSTed as plain text and a PDB comes back in seconds, with no key (unlike the
// AlphaFold DB lookup, the sequence itself is sent, to Meta). The model is renumbered to the
// project's numbering and its pLDDT (0–1 in the B-factor column) scaled to 0–100 as in AlphaFold
// models, so the viewer's pLDDT colours apply.
import { cropModel } from "./alphafold";

const ESM_ATLAS_FOLD = "https://api.esmatlas.com/foldSequence/v1/pdb/";
const USER_AGENT = "Spectre/0.1 (protein NMR backbone assignment web app)";

/** state.pdb.id of an ESMFold prediction */
export const ESMFOLD_ID = "ESMFold";

export interface EsmfoldModel {
  /** mean pLDDT (0–100) over the Cα atoms */
  meanPlddt?: number;
  /** renumbered PDB text, pLDDT 0–100 in the B-factors */
  text: string;
}

export interface PredictOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** B-factors of the ATOM/HETATM records (columns 61–66). */
function bfactors(pdb: string, atomName?: string): number[] {
  const out: number[] = [];
  for (const line of pdb.split(/\r?\n/)) {
    if (!/^(ATOM  |HETATM)/.test(line) || (atomName && line.slice(12, 16).trim() !== atomName)) continue;
    const b = parseFloat(line.slice(60, 66));
    if (Number.isFinite(b)) out.push(b);
  }
  return out;
}

/** Multiply the B-factor column by `factor`. */
export function scaleBfactors(pdb: string, factor: number): string {
  return pdb
    .split("\n")
    .map((line) => {
      if (!/^(ATOM  |HETATM)/.test(line) || line.length < 66) return line;
      const b = parseFloat(line.slice(60, 66));
      return Number.isFinite(b) ? line.slice(0, 60) + (b * factor).toFixed(2).padStart(6) + line.slice(66) : line;
    })
    .join("\n");
}

/** The ESMFold prediction of the sequence, numbered from `firstResidue`, or why there is none. */
export async function predictEsmfold(sequence: string, firstResidue: number, opts: PredictOptions = {}): Promise<EsmfoldModel | { error: string }> {
  const f = opts.fetchImpl ?? fetch;
  const seq = sequence.toUpperCase();
  let res: Response;
  try {
    res = await f(ESM_ATLAS_FOLD, { method: "POST", headers: { "content-type": "text/plain", "user-agent": USER_AGENT }, body: seq, signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000) });
  } catch (e) {
    return { error: `could not reach the ESMFold API: ${e instanceof Error ? e.message : String(e)}` };
  }
  const body = await res.text().catch(() => "");
  if (!res.ok) return { error: `the ESMFold API returned HTTP ${res.status}${body.trim() ? `: ${body.trim().slice(0, 200)}` : ""}` };
  if (!/^ATOM/m.test(body)) return { error: "the ESMFold API returned no atoms" };
  // pLDDT comes as 0–1; leave it alone should the API ever switch to 0–100
  const scaled = Math.max(...bfactors(body)) <= 1 ? scaleBfactors(body, 100) : body;
  const text = cropModel(scaled, 1, seq.length, firstResidue, "ESMFold v1 prediction (ESM Metagenomic Atlas API), pLDDT in B-factors");
  const ca = bfactors(text, "CA");
  return { ...(ca.length ? { meanPlddt: ca.reduce((a, b) => a + b, 0) / ca.length } : {}), text };
}
