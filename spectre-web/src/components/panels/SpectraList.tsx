"use client";
import { EXPERIMENTS_DESC } from "./experimentInfo";
import { useSpectre } from "@/lib/client/store";

export function SpectraList() {
  const { state, setSpectrumView, selectRoot, setPlane } = useSpectre();
  const p = state.project;
  if (!p) return null;
  const lists = new Map((p.assignment?.inputs ?? []).map((i) => [i.spectrum, i]));
  return (
    <div className="space-y-2">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="text-left text-[11px] tracking-wide text-muted uppercase">
            <th className="py-1 pr-2 font-medium">Experiment</th>
            <th className="py-1 pr-2 text-right font-medium" title="assigned peaks placed in a spin system">
              Peaks
            </th>
            <th className="py-1 text-right font-medium">Peak list</th>
          </tr>
        </thead>
        <tbody>
          {p.spectra.map((s) => {
            const l = s.file ? lists.get(s.file) : undefined;
            return (
              <tr key={s.tp} className="border-t border-line">
                <td className="py-1.5 pr-2">
                  <div className="font-medium text-fg">{s.label}</div>
                  <div className="text-[11px] text-muted">{EXPERIMENTS_DESC[s.tp] ?? ""}</div>
                </td>
                <td className="py-1.5 pr-2 text-right text-fg tabular-nums">{s.peaks.length}</td>
                <td className="max-w-[8rem] truncate py-1.5 text-right font-mono text-[11px] text-muted" title={l ? `${l.file} (${l.format})` : undefined}>
                  {l?.file ?? "–"}
                </td>
              </tr>
            );
          })}
          <tr className="border-t border-line">
            <td className="py-1.5 pr-2">
              <div className="font-medium text-fg">¹H-¹⁵N HSQC</div>
              <div className="text-[11px] text-muted">assigned amides</div>
            </td>
            <td className="py-1.5 pr-2 text-right text-fg tabular-nums">{p.hsqc.length}</td>
            <td />
          </tr>
        </tbody>
      </table>
      {p.realSpectra && p.realSpectra.length > 0 && (
        <div className="pt-1">
          <div className="mb-1 flex items-baseline gap-2">
            <span className="text-[11px] font-medium tracking-wide text-muted uppercase">Real spectra ({p.realSpectra.length})</span>
            {p.attribution && <span className="truncate text-[11px] text-faint">{p.attribution.license}</span>}
          </div>
          <ul className="m-0 list-none space-y-1 p-0">
            {p.realSpectra.map((r) => (
              <li key={r.name}>
                <button
                  type="button"
                  onClick={() => {
                    setPlane(r.name, null);
                    setSpectrumView("planes");
                  }}
                  className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[12px] ${
                    state.spectrumView === "planes" && state.planeSpectrum === r.name ? "border-accent bg-accent-faint" : "border-line hover:border-line-strong"
                  }`}
                >
                  <span className="font-medium text-fg">{r.experiment}</span>
                  <span className="rounded bg-surface-2 px-1 font-mono text-[10px] text-muted">{r.ndim}D</span>
                  {r.engineType && (
                    <span className="rounded bg-accent-faint px-1 font-mono text-[10px] text-accent" title="assigned as">
                      {r.engineType}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-faint">
                    {r.axes.map((a) => `${a.label} ${a.ppmMin.toFixed(0)}–${a.ppmMax.toFixed(0)}`).join(" × ")}
                  </span>
                  <span className="text-[11px] text-muted tabular-nums">{r.sizeMB >= 10 ? Math.round(r.sizeMB) : r.sizeMB.toFixed(1)} MB</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" className="text-[13px] text-accent hover:underline" onClick={() => setSpectrumView("hsqc")}>
          Open HSQC
        </button>
        <button
          type="button"
          className="text-[13px] text-accent hover:underline"
          onClick={() => {
            if (!state.selection.root && p.assignment?.spinSystems[0]) selectRoot(p.assignment.spinSystems[0].root);
            setSpectrumView("strips");
          }}
        >
          Open strips
        </button>
      </div>
    </div>
  );
}
