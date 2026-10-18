import { describe, expect, it } from "vitest";
import { getLandingSceneData } from "@/lib/landing/data";

describe("landing scene data", () => {
  it("builds a compact, sane story payload from the ubiquitin demo's peak lists", () => {
    const d = getLandingSceneData();
    expect(d.protein.residues.length).toBe(76);
    expect(d.protein.residues.filter((r) => r.confidence === "veryHigh").length).toBeGreaterThan(50);
    expect(d.protein.residues.filter((r) => r.confidence === "proline").map((r) => r.resi)).toEqual([19, 37, 38]);
    expect(d.hsqc.length).toBeGreaterThan(60);
    expect(d.strips.length).toBeGreaterThan(50);
    expect(d.strips.every((s) => s.peaks.length >= 1 && s.peaks.length <= 4)).toBe(true);
    // strong own CA peaks near 1, weaker i-1 echoes below
    const ca = d.strips.flatMap((s) => s.peaks.filter((p) => p.kind === "CA_i").map((p) => p.inty));
    const im1 = d.strips.flatMap((s) => s.peaks.filter((p) => p.kind === "CA_im1").map((p) => p.inty));
    expect(ca.reduce((a, b) => a + b, 0) / ca.length).toBeGreaterThan(0.8);
    expect(im1.reduce((a, b) => a + b, 0) / im1.length).toBeLessThan(0.8);
    const bytes = JSON.stringify(d).length;
    expect(bytes).toBeLessThan(60_000);
  });
});
