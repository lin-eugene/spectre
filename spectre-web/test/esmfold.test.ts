// ESMFold predictions for projects without a structure, against a fake ESM Atlas API
// (ESMFOLD_LIVE=1 also queries the real one for ubiquitin).
import { describe, expect, it } from "vitest";
import { predictEsmfold, scaleBfactors } from "@/lib/structure/esmfold";
import { parsePdb } from "@/lib/structure/pdb";
import { attachDefaultStructure, attachEsmfoldModel } from "@/lib/project/structure";
import type { ProjectState } from "@/lib/project/types";

const atom = (serial: number, name: string, resn: string, resi: number, b: number) =>
  `ATOM  ${String(serial).padStart(5)} ${name.padEnd(4)} ${resn} A${String(resi).padStart(4)}    ${"1.000".padStart(8)}${"2.000".padStart(8)}${"3.000".padStart(8)}  1.00${b.toFixed(2).padStart(6)}           ${name[0]}`;

/** what the ESM Atlas API returns for MKTA: residues from 1, pLDDT 0–1 */
const PREDICTION = ["HEADER                                            18-OCT-22", "TITLE     ESMFOLD V1 PREDICTION FOR INPUT", "REMARK   1 LICENSE AND DISCLAIMERS", ...["MET", "LYS", "THR", "ALA"].map((r, i) => atom(i + 1, "CA", r, i + 1, 0.9 - i * 0.1)), "END"].join("\n");

function fakeFetch(routes: Record<string, { status?: number; body: unknown }>, seen: { url: string; body?: unknown }[] = []): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    seen.push({ url: u, body: init?.body });
    const key = Object.keys(routes).find((k) => u.includes(k));
    if (!key) return new Response("not found", { status: 404 });
    const { status = 200, body } = routes[key];
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
}

const state = (sequence: string, firstResidue = 1) => ({ sequence, firstResidue, meta: { name: "x", source: "upload" }, history: [] }) as unknown as ProjectState;

describe("ESMFold prediction", () => {
  it("scales the B-factor column", () => {
    expect(parsePdb(scaleBfactors(atom(1, "CA", "MET", 1, 0.87), 100), "x").atoms[0].b).toBeCloseTo(87);
  });

  it("sends the sequence and renumbers the model, pLDDT on 0–100", async () => {
    const seen: { url: string; body?: unknown }[] = [];
    const out = await predictEsmfold("mkta", 10, { fetchImpl: fakeFetch({ foldSequence: { body: PREDICTION } }, seen) });
    if ("error" in out) throw new Error(out.error);
    expect(seen[0].body).toBe("MKTA");
    const m = parsePdb(out.text, "ESMFold");
    expect(m.residues.map((r) => `${r.resn}${r.resi}`)).toEqual(["MET10", "LYS11", "THR12", "ALA13"]);
    expect(m.atoms.map((a) => a.b)).toEqual([90, 80, 70, 60]);
    expect(out.meanPlddt).toBeCloseTo(75);
    expect(out.text.startsWith("REMARK   1 ESMFold")).toBe(true);
  });

  it("explains why there is no prediction", async () => {
    const down = await predictEsmfold("MKTA", 1, { fetchImpl: fakeFetch({ foldSequence: { status: 503, body: "Service Unavailable" } }) });
    expect("error" in down && down.error).toMatch(/HTTP 503: Service Unavailable/);
    const empty = await predictEsmfold("MKTA", 1, { fetchImpl: fakeFetch({ foldSequence: { body: "" } }) });
    expect("error" in empty && empty.error).toMatch(/no atoms/);
  });

  it("attaches the prediction to a project without a structure", async () => {
    const s = state("MKTA");
    const f = fakeFetch({ foldSequence: { body: PREDICTION } });
    const out = await attachEsmfoldModel(s, { fetchImpl: f });
    expect(out.ok).toBe(true);
    expect(s.pdb?.id).toBe("ESMFold");
    expect(s.history.at(-1)?.action).toBe("predict_esmfold_structure");
    expect((await attachEsmfoldModel(s, { fetchImpl: f })).ok).toBe(false); // already has one
  });

  it("falls back to the AlphaFold DB model when ESMFold fails", async () => {
    const s = state("MKTA");
    const f = fakeFetch({
      foldSequence: { status: 500, body: "" },
      "uniparc/search": { body: { results: [{ uniProtKBAccessions: ["Q00001"] }] } },
      "api/prediction/Q00001": { body: [{ modelEntityId: "AF-Q00001-F1", uniprotAccession: "Q00001", sequence: "MKTA", pdbUrl: "https://alphafold.ebi.ac.uk/files/AF-Q00001-F1-model_v6.pdb" }] },
      "model_v6.pdb": { body: PREDICTION },
    });
    const out = await attachDefaultStructure(s, { fetchImpl: f });
    expect(out.ok).toBe(true);
    expect(s.pdb?.id).toBe("AF-Q00001-F1");
    const neither = await attachDefaultStructure(state("MKTA"), { fetchImpl: fakeFetch({ foldSequence: { status: 500, body: "" } }) });
    expect(!neither.ok && neither.error).toMatch(/^ESMFold: .*; AlphaFold DB: /);
  });

  it.skipIf(process.env.ESMFOLD_LIVE !== "1")("predicts the real structure of ubiquitin", { timeout: 60_000 }, async () => {
    const seq = "MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG";
    const out = await predictEsmfold(seq, 1);
    if ("error" in out) throw new Error(out.error);
    expect(parsePdb(out.text, "ESMFold").residues).toHaveLength(76);
    expect(out.meanPlddt).toBeGreaterThan(50);
  });
});
