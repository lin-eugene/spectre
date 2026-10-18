// AlphaFold DB models for projects without a structure, against a fake UniProt / AlphaFold DB
// (ALPHAFOLD_LIVE=1 also queries the real services for ubiquitin).
import { describe, expect, it } from "vitest";
import { accessionsForSequence, cropModel, findAlphafoldModel } from "@/lib/structure/alphafold";
import { parsePdb } from "@/lib/structure/pdb";
import { attachAlphafoldModel } from "@/lib/project/structure";
import type { ProjectState } from "@/lib/project/types";

const atom = (serial: number, name: string, resn: string, resi: number, b: number) =>
  `ATOM  ${String(serial).padStart(5)} ${name.padEnd(4)} ${resn} A${String(resi).padStart(4)}    ${"1.000".padStart(8)}${"2.000".padStart(8)}${"3.000".padStart(8)}  1.00${b.toFixed(2).padStart(6)}           ${name[0]}`;

/** a 6-residue AlphaFold model, MKTAYI, residues 1-6 */
const MODEL = ["HEADER    PREDICTED MODEL", ...["MET", "LYS", "THR", "ALA", "TYR", "ILE"].map((r, i) => atom(i + 1, "CA", r, i + 1, 90 - i)), "END"].join("\n");

function fakeFetch(routes: Record<string, unknown>): typeof fetch {
  return (async (url: string | URL | Request) => {
    const u = String(url);
    const key = Object.keys(routes).find((k) => u.includes(k));
    if (!key) return new Response("not found", { status: 404 });
    const body = routes[key];
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}

const AFDB_ENTRY = {
  modelEntityId: "AF-Q00001-F1",
  uniprotAccession: "Q00001",
  latestVersion: 6,
  globalMetricValue: 87.5,
  sequence: "MKTAYI",
  sequenceStart: 1,
  pdbUrl: "https://alphafold.ebi.ac.uk/files/AF-Q00001-F1-model_v6.pdb",
};

describe("AlphaFold DB lookup", () => {
  it("finds active UniProt accessions by the sequence checksum", async () => {
    const f = fakeFetch({ "uniparc/search": { results: [{ uniProtKBAccessions: ["P12345.1", "Q00001", "Q00002", "Q00001"] }] } });
    expect(await accessionsForSequence("KTAY", { fetchImpl: f })).toEqual(["Q00001", "Q00002"]);
  });

  it("crops and renumbers a model to the project's residues", () => {
    const text = cropModel(MODEL, 2, 5, 10, "test");
    const m = parsePdb(text, "AF");
    expect(m.residues.map((r) => r.resi)).toEqual([10, 11, 12, 13]);
    expect(m.residues.map((r) => r.resn)).toEqual(["LYS", "THR", "ALA", "TYR"]);
    expect(text.startsWith("REMARK   1 test")).toBe(true);
  });

  it("uses the first model that contains the sequence, cropped to it", async () => {
    const f = fakeFetch({
      "uniparc/search": { results: [{ uniProtKBAccessions: ["Q00009", "Q00001"] }] },
      "api/prediction/Q00001": [AFDB_ENTRY],
      "AF-Q00001-F1-model_v6.pdb": MODEL,
    });
    const found = await findAlphafoldModel("KTAY", 1, { fetchImpl: f });
    if ("error" in found) throw new Error(found.error);
    expect(found.entryId).toBe("AF-Q00001-F1");
    expect(found.region).toEqual([2, 5]);
    expect(found.meanPlddt).toBe(87.5);
    const m = parsePdb(found.text, found.entryId);
    expect(m.residues.map((r) => `${r.resn}${r.resi}`)).toEqual(["LYS1", "THR2", "ALA3", "TYR4"]);
  });

  it("explains why there is no model", async () => {
    const none = await findAlphafoldModel("KTAY", 1, { fetchImpl: fakeFetch({ "uniparc/search": { results: [] } }) });
    expect("error" in none && none.error).toMatch(/no UniProt entry/);
    const unmodelled = await findAlphafoldModel("KTAY", 1, { fetchImpl: fakeFetch({ "uniparc/search": { results: [{ uniProtKBAccessions: ["Q00009"] }] } }) });
    expect("error" in unmodelled && unmodelled.error).toMatch(/no model containing/);
  });

  it("attaches the model to a project without a structure", async () => {
    const state = { sequence: "MKTAYI", firstResidue: 1, meta: { name: "x", source: "upload" }, history: [] } as unknown as ProjectState;
    const f = fakeFetch({ "uniparc/search": { results: [{ uniProtKBAccessions: ["Q00001"] }] }, "api/prediction/Q00001": [AFDB_ENTRY], "model_v6.pdb": MODEL });
    const out = await attachAlphafoldModel(state, { fetchImpl: f });
    expect(out.ok).toBe(true);
    expect(state.pdb?.id).toBe("AF-Q00001-F1");
    expect(state.meta.uniprot).toBe("Q00001");
    expect(state.history.at(-1)?.action).toBe("fetch_alphafold_structure");
    expect((await attachAlphafoldModel(state, { fetchImpl: f })).ok).toBe(false); // already has one
  });

  it.skipIf(process.env.ALPHAFOLD_LIVE !== "1")("finds the real AlphaFold DB model of ubiquitin", { timeout: 60_000 }, async () => {
    const seq = "MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG";
    const found = await findAlphafoldModel(seq, 1);
    if ("error" in found) throw new Error(found.error);
    expect(parsePdb(found.text, found.entryId).residues).toHaveLength(76);
  });
});
