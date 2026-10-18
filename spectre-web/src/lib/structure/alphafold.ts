// AlphaFold DB models for projects that have no structure. Candidates are the project's UniProt
// accession and every UniProt entry with exactly the project's sequence, found through UniParc by
// the sequence's MD5 checksum (so the sequence itself is never sent anywhere). The first AlphaFold DB
// model whose sequence contains the project's sequence is used, cropped to that region and
// renumbered to the project's numbering; its B-factor column holds the pLDDT.
import { createHash } from "node:crypto";

const AFDB = "https://alphafold.ebi.ac.uk";
const UNIPARC = "https://rest.uniprot.org/uniparc/search";
/** most UniProt accessions tried against AlphaFold DB */
const MAX_CANDIDATES = 8;
/** AlphaFold DB refuses requests with Node's default User-Agent (HTTP 403) */
const HEADERS = { accept: "application/json", "user-agent": "Spectre/0.1 (protein NMR backbone assignment web app)" };

export interface AlphafoldModel {
  /** e.g. "AF-P0CG48-F1" */
  entryId: string;
  accession: string;
  version: number;
  /** mean pLDDT of the whole model */
  meanPlddt?: number;
  /** model residues (its own numbering) that match the project's sequence */
  region: [number, number];
  /** the AlphaFold DB entry page */
  url: string;
  /** cropped, renumbered PDB text */
  text: string;
}

interface AfdbEntry {
  entryId?: string;
  modelEntityId?: string;
  uniprotAccession?: string;
  latestVersion?: number;
  globalMetricValue?: number;
  pdbUrl?: string;
  sequence?: string;
  uniprotSequence?: string;
  sequenceStart?: number;
  uniprotStart?: number;
}

export interface FindOptions {
  /** the project's UniProt accession, tried first */
  uniprot?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** UniProt accessions of the entries with exactly this sequence (active ones; UniParc lists retired ones as "ACC.n"). */
export async function accessionsForSequence(sequence: string, opts: FindOptions = {}): Promise<string[]> {
  const f = opts.fetchImpl ?? fetch;
  const md5 = createHash("md5").update(sequence.toUpperCase()).digest("hex").toUpperCase();
  const res = await f(`${UNIPARC}?query=checksum:${md5}&fields=upi,accession&format=json&size=5`, { headers: HEADERS, signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000) });
  if (!res.ok) throw new Error(`UniProt returned HTTP ${res.status}`);
  const body = (await res.json()) as { results?: { uniProtKBAccessions?: (string | { id?: string })[] }[] };
  const out: string[] = [];
  for (const r of body.results ?? []) {
    for (const a of r.uniProtKBAccessions ?? []) {
      const acc = typeof a === "string" ? a : a.id;
      if (acc && !acc.includes(".") && !out.includes(acc)) out.push(acc);
    }
  }
  return out;
}

/** Keep the model's residues lo..hi, renumbered so that lo becomes `first`, with a provenance remark. */
export function cropModel(pdb: string, lo: number, hi: number, first: number, remark: string): string {
  const out = [`REMARK   1 ${remark}`.slice(0, 80)];
  for (const line of pdb.split(/\r?\n/)) {
    if (/^(ATOM  |HETATM|TER   )/.test(line)) {
      const resi = parseInt(line.slice(22, 26), 10);
      if (!Number.isFinite(resi) || resi < lo || resi > hi) continue;
      out.push(line.slice(0, 22) + String(resi - lo + first).padStart(4) + line.slice(26));
    } else if (/^(HEADER|TITLE |SOURCE|EXPDTA)/.test(line)) {
      out.push(line);
    }
  }
  out.push("END");
  return out.join("\n") + "\n";
}

/** The AlphaFold DB model of the project's sequence, or why there is none. */
export async function findAlphafoldModel(sequence: string, firstResidue: number, opts: FindOptions = {}): Promise<AlphafoldModel | { error: string }> {
  const f = opts.fetchImpl ?? fetch;
  const timeout = () => AbortSignal.timeout(opts.timeoutMs ?? 15_000);
  const seq = sequence.toUpperCase();
  const candidates: string[] = [];
  if (opts.uniprot) candidates.push(opts.uniprot.trim());
  try {
    for (const acc of await accessionsForSequence(seq, opts)) if (!candidates.includes(acc)) candidates.push(acc);
  } catch (e) {
    if (!candidates.length) return { error: `could not look the sequence up in UniProt: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!candidates.length) return { error: "no UniProt entry has exactly this sequence, so AlphaFold DB has no model of it" };
  for (const acc of candidates.slice(0, MAX_CANDIDATES)) {
    let entries: AfdbEntry[];
    try {
      const res = await f(`${AFDB}/api/prediction/${encodeURIComponent(acc)}`, { headers: HEADERS, signal: timeout() });
      if (!res.ok) continue; // 404: no model for this accession
      entries = (await res.json()) as AfdbEntry[];
    } catch {
      continue;
    }
    for (const e of entries) {
      const modelSeq = (e.sequence ?? e.uniprotSequence ?? "").toUpperCase();
      const at = modelSeq.indexOf(seq);
      if (at < 0 || !e.pdbUrl) continue;
      const start = e.sequenceStart ?? e.uniprotStart ?? 1;
      const lo = start + at;
      const hi = lo + seq.length - 1;
      const entryId = e.modelEntityId ?? e.entryId ?? `AF-${acc}-F1`;
      let pdb: string;
      try {
        const res = await f(e.pdbUrl, { headers: { "user-agent": HEADERS["user-agent"] }, signal: timeout() });
        if (!res.ok) continue;
        pdb = await res.text();
      } catch {
        continue;
      }
      const remark = `AlphaFold DB ${entryId} v${e.latestVersion ?? "?"}, residues ${lo}-${hi}, pLDDT in B-factors`;
      const text = cropModel(pdb, lo, hi, firstResidue, remark);
      if (!/^ATOM/m.test(text)) continue;
      return {
        entryId,
        accession: e.uniprotAccession ?? acc,
        version: e.latestVersion ?? 0,
        ...(typeof e.globalMetricValue === "number" ? { meanPlddt: e.globalMetricValue } : {}),
        region: [lo, hi],
        url: `${AFDB}/entry/${e.uniprotAccession ?? acc}`,
        text,
      };
    }
  }
  return { error: `AlphaFold DB has no model containing this sequence (tried ${candidates.slice(0, MAX_CANDIDATES).join(", ")})` };
}
