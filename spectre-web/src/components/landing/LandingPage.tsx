// The landing page content. It sits above the fixed 3D story canvas (rendered by the page): each
// story section carries data-act (scroll position -> scene) and data-side (where its text sits, so
// the canvas can move its subject to the other half). Act sections stay transparent; the solid
// bands between "assign" and "cta" deliberately cover the canvas.
import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";
import LandingNav from "./LandingNav";
import Reveal from "./Reveal";
import {
  IconArrowRight,
  IconAtom,
  IconCap,
  IconChat,
  IconCheck,
  IconCode,
  IconCube,
  IconDownload,
  IconFlask,
  IconLayout,
  IconMolecule,
  IconPill,
  IconPlay,
  IconWave,
} from "./icons";

// app links land on the top of the entry page
const APP = "/app#top";
const REAL = "/app?open=2k50#top";

const CONFIDENCE = [
  { color: "var(--conf-very-high)", name: "Confirmed", text: "consistent and linked to a neighbour" },
  { color: "var(--conf-high)", name: "Unconfirmed", text: "no conflict; unlinked or unusual shift" },
  { color: "var(--conf-low)", name: "Conflict", text: "peaks disagree or shift implausible" },
  { color: "var(--conf-unassigned)", name: "Unassigned", text: "no peaks assigned to the amide" },
  { color: "var(--conf-proline)", name: "Proline", text: "no amide proton, so no peak" },
];

const PEAKS = [
  { color: "#15803d", label: "Cα of this residue" },
  { color: "#6d28d9", label: "Cβ of this residue" },
  { color: "#4ade80", label: "Cα of the one before" },
  { color: "#a78bfa", label: "Cβ of the one before" },
];

const FEATURES = [
  { icon: IconLayout, title: "AlphaFold-style entry page", text: "Sequence, spectra and structure side by side, all in the same consistency colours." },
  { icon: IconCube, title: "3D strips cube", text: "The HNCACB strips as a cube you can rotate, slice and click through." },
  { icon: IconAtom, title: "Interactive structure", text: "A three.js model of the protein: hover any atom to see what it is." },
  { icon: IconChat, title: "AI assistant", text: "Ask in plain English. It runs any step for you, from import to export." },
  { icon: IconWave, title: "Your peak lists, as they are", text: "Sparky, XEASY/CYANA, NMRPipe and CcpNmr Analysis lists, each with its spectrum." },
  { icon: IconDownload, title: "Standard exports", text: "NMR-STAR, BMRB table, Sparky, assignment and peak lists." },
];

const AUDIENCES = [
  { icon: IconFlask, title: "NMR labs", text: "Every residue checked against its peaks, so the experts spend their time on the conflicts." },
  { icon: IconCap, title: "Students", text: "See what assignment really is: strips, links and checks, all clickable." },
  { icon: IconPill, title: "Drug discovery", text: "Assigned spectra show where a ligand binds. Check the map before you trust it." },
  { icon: IconMolecule, title: "Structural biologists", text: "Put the NMR evidence on the 3D structure, residue by residue." },
  { icon: IconCode, title: "Tool builders", text: "Every step is an API action, the same ones the assistant calls." },
];

function FreeChips() {
  return (
    <div className="lp-chips">
      {["Free", "No install", "No account"].map((t) => (
        <span key={t} className="lp-chip">
          <IconCheck size={15} strokeWidth={2.4} />
          {t}
        </span>
      ))}
    </div>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <span className="lp-step">
      <span className="lp-step-num">{n}</span>
      <span className="lp-step-label">{children}</span>
    </span>
  );
}

const rise = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

export default function LandingPage() {
  return (
    <div className="lp-root" id="top">
      <noscript dangerouslySetInnerHTML={{ __html: "<style>.lp-reveal{opacity:1;transform:none}</style>" }} />
      <LandingNav />

      <main>
        <section data-act="hero" data-side="left" className="lp-hero" aria-labelledby="lp-hero-title">
          <div className="lp-wrap lp-hero-inner">
            <div className="lp-hero-copy">
              <p className="lp-hero-logo lp-rise" style={rise(0)}>
                <Image src="/landing/logo-512.png" alt="" width={34} height={30} preload style={{ width: 34, height: 30 }} />
                <span>Spectre</span>
                <span className="lp-hero-logo-sep" aria-hidden="true" />
                <span className="lp-hero-logo-free">Free for everyone</span>
              </p>
              <h1 id="lp-hero-title" className="lp-h1 lp-rise" style={rise(80)}>
                Checking the <span className="lp-grad-text">slowest step</span> in protein NMR, for free
              </h1>
              <p className="lp-lead lp-rise" style={rise(160)}>
                Working out which peak belongs to which atom of a protein takes an expert days to weeks. Spectre reads your spectra and
                assigned peak lists, checks every residue for consistency and colours the result onto the 3D structure, AlphaFold-style.
              </p>
              <div className="lp-hero-actions lp-rise" style={rise(240)}>
                <a className="lp-btn lp-btn-primary lp-btn-lg" href={APP}>
                  Open Spectre — it&rsquo;s free
                  <IconArrowRight size={19} />
                </a>
                <a className="lp-btn lp-btn-ghost lp-btn-lg" href={REAL}>
                  <IconPlay size={19} />
                  See it on real spectra
                </a>
              </div>
              <div className="lp-rise" style={rise(300)}>
                <FreeChips />
              </div>
            </div>
          </div>
          <a className="lp-scrollcue" href="#how">
            <span aria-hidden="true" />
            Scroll
          </a>
        </section>

        <section data-act="problem" data-side="right" className="lp-act" id="how" aria-labelledby="lp-problem-title">
          <div className="lp-wrap lp-act-sticky">
            <Reveal className="lp-card">
              <span className="lp-eyebrow">The problem</span>
              <h2 id="lp-problem-title" className="lp-h2">
                NMR can watch proteins move. First, every peak needs a name.
              </h2>
              <p className="lp-p">
                A protein&rsquo;s NMR spectra hold hundreds to thousands of peaks. Before they can tell you how it folds, flexes or binds a
                drug, each one has to be traced back to the atom that made it.
              </p>
              <ul className="lp-list lp-hide-sm" style={{ "--dot": "var(--conf-unassigned)" } as CSSProperties}>
                <li>Peaks overlap, go missing, or turn out to be noise.</li>
                <li>Every residue has to be chained to its neighbours through shared carbon shifts, across several 3D spectra.</li>
                <li>One wrong link can throw off everything after it.</li>
              </ul>
              <p className="lp-fine lp-hide-sm">
                This is resonance assignment, the slowest step in protein NMR. Done by hand it takes days to weeks of expert time.
              </p>
            </Reveal>
          </div>
        </section>

        <section data-act="spectra" data-side="left" className="lp-act" aria-labelledby="lp-spectra-title">
          <div className="lp-wrap lp-act-sticky">
            <Reveal className="lp-card">
              <Step n={1}>Read the spectra</Step>
              <h2 id="lp-spectra-title" className="lp-h2">
                Every amide gets a fingerprint.
              </h2>
              <p className="lp-p">
                Each backbone amide shows up as one dot in the ¹H–¹⁵N plane, as in an HSQC. Spectre reads the assigned peak lists of your
                3D experiments and gathers the peaks above each dot into a spin system: the little bundle of signals of one residue.
              </p>
              <p className="lp-p lp-hide-sm">
                Upload NMRPipe spectra with Sparky, XEASY, NMRPipe or CcpNmr peak lists, or open real spectra from the built-in ARTINA library.
              </p>
              <a className="lp-card-link" href="/app?view=hsqc#top">
                Open the HSQC view <IconArrowRight size={16} />
              </a>
            </Reveal>
          </div>
        </section>

        <section data-act="strips" data-side="right" className="lp-act" aria-labelledby="lp-strips-title">
          <div className="lp-wrap lp-act-sticky">
            <Reveal className="lp-card">
              <Step n={2}>Line up the strips</Step>
              <h2 id="lp-strips-title" className="lp-h2">
                Strips turn a 3D spectrum into a chain you can follow.
              </h2>
              <p className="lp-p">
                Slice the HNCACB cube at each amide and you get a strip: the residue&rsquo;s own Cα and Cβ, plus fainter echoes of the
                residue before it. Match each strip&rsquo;s echoes to its neighbour and the residues line up like dominoes.
              </p>
              <div className="lp-peaks">
                {PEAKS.map((p) => (
                  <span key={p.label}>
                    <i style={{ "--c": p.color } as CSSProperties} />
                    {p.label}
                  </span>
                ))}
              </div>
              <a className="lp-card-link" href="/app?view=strips3d#top">
                Rotate the strips cube <IconArrowRight size={16} />
              </a>
            </Reveal>
          </div>
        </section>

        <section data-act="assign" data-side="left" className="lp-act" aria-labelledby="lp-assign-title">
          <div className="lp-wrap lp-act-sticky">
            <Reveal className="lp-card">
              <Step n={3}>Check every residue</Step>
              <h2 id="lp-assign-title" className="lp-h2">
                Every residue gets a check and a colour.
              </h2>
              <p className="lp-p">
                Do the peaks of each atom agree across spectra and strips? Do the sequential carbons link each residue to its neighbour?
                Are the shifts plausible for the residue type? The answers are painted onto the 3D structure in the colours structural
                biologists know from AlphaFold.
              </p>
              <div className="lp-legend" role="list" aria-label="Consistency colours">
                {CONFIDENCE.map((c) => (
                  <div key={c.name} className="lp-legend-row" role="listitem">
                    <i style={{ background: c.color }} />
                    <span>{c.name}</span>
                    <em>{c.text}</em>
                  </div>
                ))}
              </div>
              <p className="lp-fine">Conflicts are flagged, never hidden.</p>
            </Reveal>
          </div>
        </section>

        <section className="lp-band lp-band-alt" id="features" aria-labelledby="lp-features-title">
          <div className="lp-wrap">
            <Reveal className="lp-band-head">
              <span className="lp-eyebrow">What&rsquo;s inside</span>
              <h2 id="lp-features-title" className="lp-h2">
                From peak lists to checked shifts, on one page.
              </h2>
            </Reveal>
            <div className="lp-features">
              {FEATURES.map((f, i) => (
                <Reveal key={f.title} className="lp-feature" delay={(i % 3) * 70}>
                  <span className="lp-feature-icon">
                    <f.icon size={22} />
                  </span>
                  <h3>{f.title}</h3>
                  <p>{f.text}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-band" id="who" aria-labelledby="lp-who-title">
          <div className="lp-wrap">
            <Reveal className="lp-band-head">
              <span className="lp-eyebrow">Who it&rsquo;s for</span>
              <h2 id="lp-who-title" className="lp-h2">
                For anyone who has ever stared at an HSQC.
              </h2>
            </Reveal>
            <div className="lp-who">
              {AUDIENCES.map((a, i) => (
                <Reveal key={a.title} className="lp-who-item" delay={i * 60}>
                  <span className="lp-who-icon">
                    <a.icon size={24} />
                  </span>
                  <h3>{a.title}</h3>
                  <p>{a.text}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section data-act="cta" data-side="center" className="lp-act lp-act-cta" id="start" aria-labelledby="lp-cta-title">
          <div className="lp-wrap lp-act-sticky">
            <Reveal className="lp-cta lp-cta-panel">
              <Image className="lp-cta-logo lp-hide-sm" src="/landing/logo-512.png" alt="" width={72} height={64} style={{ width: 72, height: 64 }} />
              <h2 id="lp-cta-title" className="lp-h2">
                Check your first protein <span className="lp-grad-text">in the next minute.</span>
              </h2>
              <p className="lp-p">
                Open the ubiquitin demo and see its peak lists checked residue by residue, then try real spectra from the ARTINA library or upload your own.
              </p>
              <div className="lp-cta-actions">
                <a className="lp-btn lp-btn-primary lp-btn-lg" href={APP}>
                  Open Spectre — it&rsquo;s free
                  <IconArrowRight size={19} />
                </a>
                <a className="lp-btn lp-btn-ghost lp-btn-lg" href={REAL}>
                  <IconPlay size={19} />
                  See it on real spectra
                </a>
              </div>
              <FreeChips />
              <p className="lp-fine lp-hide-sm">
                The optional AI chat runs on Claude or any OpenAI-compatible model set up on the server. Real-spectra projects download their
                spectra and deposited peak lists from nmrdb.ethz.ch the first time (2K50 is about 184 MB).
              </p>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-grid">
          <div>
            <a href="#top" className="lp-brand">
              <Image src="/logo.png" alt="" width={36} height={32} style={{ width: 36, height: 32 }} />
              <span>Spectre</span>
            </a>
            <p>Checking the slowest step in protein NMR.</p>
            <p>Free · no install · no account</p>
            <div className="lp-footer-links">
              <a href={APP}>Open the app</a>
              <a href={REAL}>Real spectra (2K50)</a>
              <a href="#top">Back to top</a>
            </div>
          </div>
          <div>
            <h4>Credits</h4>
            <ul className="lp-credits">
              <li>Assignments come from your own peak lists; Spectre checks them against each other and against BMRB statistics.</li>
              <li>
                Real spectra and assigned peak lists: the ARTINA NMR dataset, Klukowski et al., ETH Zürich (
                <a href="https://nmrdb.ethz.ch/" target="_blank" rel="noopener noreferrer">
                  nmrdb.ethz.ch
                </a>
                ), CC BY 4.0.
              </li>
              <li>
                Ubiquitin demo: chemical shifts from{" "}
                <a href="https://bmrb.io/data_library/summary/index.php?bmrbId=6457" target="_blank" rel="noopener noreferrer">
                  BMRB 6457
                </a>
                {" "}(as assigned Sparky peak lists), structure{" "}
                <a href="https://www.rcsb.org/structure/1UBQ" target="_blank" rel="noopener noreferrer">
                  PDB 1UBQ
                </a>
                .
              </li>
              <li>
                The consistency colours follow the AlphaFold DB palette. Spectre is an independent hackathon project, not affiliated with
                AlphaFold, BMRB or ETH Zürich.
              </li>
            </ul>
          </div>
        </div>
      </footer>
    </div>
  );
}
