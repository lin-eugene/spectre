"use client";
// Throwaway harness for the Bruker 1D view (processing workstream).
import { useEffect, useState } from "react";
import Bruker1DView from "@/components/spectrum/Bruker1DView";

const card = { border: "1px solid rgba(127,127,127,0.25)", borderRadius: 12, padding: 12 } as const;

export default function BrukerDevPage() {
  const [exp, setExp] = useState<string | null>(null);
  const [exp2, setExp2] = useState<string | null>("B81450");
  const [exp3, setExp3] = useState<string | null>("B81458");
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("theme");
    if (t) document.documentElement.dataset.theme = t;
  }, []);
  return (
    <main style={{ padding: 16, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start", background: "var(--dev-bg, transparent)" }}>
      <section style={{ ...card, width: 560, maxWidth: "100%" }}>
        <Bruker1DView experiment={exp} onExperimentChange={setExp} height={520} />
      </section>
      <section style={{ ...card, width: 560, maxWidth: "100%" }}>
        <Bruker1DView experiment={exp2} onExperimentChange={setExp2} height={520} initialRange={[1.985, 1.895]} initialFitRegion={[1.975, 1.905]} />
      </section>
      <section style={{ ...card, width: 400, maxWidth: "100%" }}>
        <Bruker1DView experiment={exp3} onExperimentChange={setExp3} height={460} initialCompare={["B81459", "B81461"]} initialStacked initialRange={[8.6, 6.4]} />
      </section>
    </main>
  );
}
