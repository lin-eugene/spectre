# Spectre

Spectre is a Next.js 16.4 web app for protein NMR backbone assignment. It takes your 3D
triple-resonance spectra and the assigned peak lists from your assignment software, builds the
backbone assignment from the lists and checks every residue for consistency:
- each peak goes to the spin system of its amide's residue, and its carbon is labelled relative
  to it (CA(i), CB(i-1), C′(i)…); a residue's shifts are the means over its peaks;
- peaks of one atom that disagree across spectra, or between the strips of residues i and i+1,
  are a conflict, and so is a carbon shift implausible for the residue type;
- a Cα, Cβ or C′ of residue i that matches the (i-1) peak of residue i+1 links the two.

Spectre is a concept for a user interface that makes NMR assignment and analysis more intuitive;
peak picking and an automated assignment backend are future work (see the
[repository README](../README.md#status-and-next-steps)).

Nothing is placed or changed: the assignment is yours. The page is laid out like an AlphaFold DB
entry: a sequence coloured by the check, a spectrum panel where AlphaFold shows the PAE plot, a
three.js structure, and a legend. A Claude agent can drive every function through tools from a
chat drawer.

## Run

```sh
npm install
npm run dev            # http://localhost:3000
```

`/` is the landing page, a scroll-driven 3D story of what assignment is and how Spectre checks it.
The app is at `/app`. Its default project is the ubiquitin demo. The ARTINA protein 2K50 with its
measured spectra opens from the landing page (`/app?open=2k50`): the first time, the app downloads
its spectra and deposited peak lists from nmrdb.ethz.ch (about 185 MB, once), with progress in the
top bar.

Everything except the chat works without credentials.

## Projects

- **Your own data** (project menu, "New project from your spectra…"). Provide:
  - **Sequence:** a FASTA file, a plain one-letter sequence, or three-letter codes, plus the
    number of the first residue. Number it like your peak lists: a list whose residue names fit
    the sequence only with another numbering is refused, with the first residue number it needs.
  - **For each 3D spectrum, the NMRPipe file and its assigned peak list.** Spectra are NMRPipe 3D
    files (`.pipe`, `.ft3`, …) with ¹H, ¹⁵N and ¹³C axes in any order; the types are HNCA,
    HN(CO)CA, HNCACB, CBCANH, HN(CO)CACB, CBCA(CO)NH, HNCO and HN(CA)CO, guessed from the file
    name. Peak lists can be:
    - Sparky `.list` (`Assignment w1 w2 w3 [Data Height]`, labels like `E4N-P3CA-E4H`);
    - XEASY / CYANA `.peaks` (atoms as `CA.3`, or as numbers of a `.prot` shift list, which you
      then upload too);
    - NMRPipe `.tab` (`X_PPM`… and an `ASS` column such as `E4N-P3CA-E4H`);
    - CcpNmr Analysis peak-table exports (`.csv`/`.tsv` with `Assign F1…` and `Pos F1…`, version 2
      or 3 atom names).

    The format is detected; the ¹H, ¹⁵N and ¹³C columns are told apart by the atoms assigned in
    them, else by their names, else by their ppm ranges. Lists without heights take them from the
    spectrum.
  - **Structure:** none is needed. The app predicts one from the sequence with
    [ESMFold](https://esmatlas.com/) (the public ESM Atlas API: a few seconds, no key, and the
    sequence is sent to Meta). If that fails it uses the AlphaFold DB model of the sequence, when
    there is one. The panel's "Predict with ESMFold" button and the agent's
    `predict_esmfold_structure` try again later.

  Files are streamed to `.data/uploads/<project>/` (up to `SPECTRE_MAX_UPLOAD_MB`, default
  2048 MB per file). Spectra and peak lists can be added, replaced or removed in the project's
  "Spectra and peak lists" panel; every change rebuilds the assignment. To fix a conflict, correct
  the list in your assignment software and upload it again.
- **ARTINA proteins** (Library dialog, or the agent's `import_artina_protein`): the app downloads
  the protein's NMRPipe backbone spectra (HNCO, HN(CA)CO, HNCA, HN(CO)CA, CBCANH, CBCA(CO)NH,
  whichever exist) with their deposited assigned Sparky lists, its 15N HSQC (display only) and
  the deposited structures. The sequence comes from the deposited structure.
- **Ubiquitin demo**: see Data.

The check, per assigned residue (`src/lib/peaklists/build.ts`, tolerances in
`CONSISTENCY_TOLERANCE`, `src/lib/contract.ts`):
- **Conflict** (yellow): peaks of one atom more than 0.06 ppm (¹H), 0.6 ppm (¹⁵N) or 0.5 ppm (¹³C)
  apart, a carbon more than 5 BMRB standard deviations from its residue type's average, or a peak
  on an atom the residue type lacks (a glycine Cβ, a proline amide).
- **Confirmed** (dark blue): no conflict, linked to a neighbour (a carbon within 0.35 ppm of its
  (i-1) peak), and no shift more than 3.5 standard deviations from its type's average.
- **Unconfirmed** (light blue): everything else that is assigned.

Peaks a list cannot place (amide unassigned, residue outside the sequence or of another type) are
left out and reported under the Peak lists panel and Problems.

API:
- `POST /api/projects` (no body, or `{demo: "ubiquitin" | "2K50"}`) → a new demo project `{id}`,
  or the 2K50 project `{id}`, or `202 {jobId}` while 2K50 is being imported.
- `POST /api/projects {upload: {name, sequence, firstResidue}}` → `{id}`
- `PUT /api/projects/[id]/uploads` with the file as the body:
  `?kind=spectrum&file=<name>&type=<hnca|…>` → `{spectrum}`;
  `?kind=peaklist&spectrum=<spectrum name>&file=<name>[&format=sparky|xeasy|nmrpipe|ccpn]` →
  `{peakList, warnings}`; `?kind=shiftlist&file=<name>` (XEASY `.prot`) → `{entries}`.
  `DELETE` the same path with `?name=<spectrum>` (spectrum and list), `?peaklist=<spectrum>` or
  `?shiftlist=1`.
- `POST /api/artina/import {id}` → `{jobId}`; `GET /api/artina/import/[jobId]` for its stages
  (download, build).

Projects saved by earlier versions of the app (including those assigned by the former autoAssign
engine) are left in `.data/projects/` but are not listed.

Deep links go to the app: `/app?open=2k50` (the 2K50 project, as linked from the landing page),
`/app?project=<id>`, `/app?view=hsqc|strips|strips3d|matrix|bruker1d|planes`, `/app?residue=<n>`,
`/app?library=open` and `/app?chat=open`.

## Bruker 1D

The `bruker1d` view processes raw Bruker 1D experiments in the browser: Fourier transform,
phasing, baseline, peak picking and pseudo-Voigt line fitting. The agent can do the same with
`list_bruker_experiments`, `process_bruker_1d` and `deconvolve_1d`. No experiments are bundled:
put experiment folders (each with `fid`, `acqus`, `procs` and optionally `title`) in
`.data/bruker1h/`, which git ignores, or set `SPECTRE_BRUKER_DIR` to their directory. The
processing tests compare against TopSpin when `B81434` (with TopSpin's `1r` beside its `fid`) is
there, and are skipped otherwise.

## Chat

To enable the chat, create `.env.local`:

```
# Claude
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-opus-5-5   # optional, default
ANTHROPIC_EFFORT=medium           # optional, default

# or any OpenAI-compatible Chat Completions endpoint (OpenAI, OpenRouter, Groq, Together,
# vLLM, Ollama, LM Studio, ...); the model must support tool/function calling
OPENAI_BASE_URL=http://localhost:11434/v1   # default https://api.openai.com/v1
OPENAI_MODEL=llama3.1
OPENAI_API_KEY=...                          # optional for local servers
# optional: OPENAI_EXTRA_HEADERS='{"HTTP-Referer":"https://example.org"}',
# OPENAI_MAX_TOKENS, OPENAI_TOKENS_PARAM=max_tokens|max_completion_tokens, OPENAI_TEMPERATURE,
# OPENAI_REASONING_EFFORT=low|medium|high, OPENAI_API=chat|responses (default: OpenAI's
# Responses API for api.openai.com, Chat Completions elsewhere, switching to Responses when a
# server says the model needs it)

LLM_PROVIDER=anthropic   # which one to use by default when both are set
```

With both configured, the chat header's model menu switches provider per browser and accepts any
model name for the OpenAI-compatible server. `GET /api/agent/config` lists the configured
providers (never the keys).

Other settings: `SPECTRE_DATA_DIR` (project store and download cache, default `.data/`),
`SPECTRE_CUBE_CACHE_MB` (in-memory cache for real spectra, default 1536),
`SPECTRE_DISABLE_FALLBACK=1`.

## Tests

```sh
npm test             # vitest; the ARTINA tests use the local download cache (.data/artina) and are skipped without it
npm run lint
npm run build
```

## Data

- **Ubiquitin** (`data/demo/ubiquitin`): assigned Sparky peak lists of an HNCA, HNCACB, HNCO and
  HN(CA)CO written from the BMRB 6457 shifts, with jitter, a few missing (i-1) peaks and three
  exchange-broadened amides (no spectra). `npm run data:demo` rebuilds them.
- **BMRB statistics** (`data/raw/bmrb_aa_full.csv`, from
  <https://bmrb.io/ftp/pub/bmrb/statistics/chem_shifts/aa_full.csv>): residue typing and the
  plausibility test of the check, and average shifts in the structure viewer's atom tooltips.
  `node scripts/build-bmrb-stats.mjs` regenerates `src/lib/structure/bmrb-stats.ts`.
- **ARTINA NMR spectra dataset** (<https://nmrdb.ethz.ch/>, CC BY 4.0, Klukowski et al., ETH
  Zürich): 100 proteins with real 2D–4D spectra and deposited assigned peak lists. The catalogue
  is `data/artina/catalog.json`; files download on demand to `.data/artina/<ID>/`.

## Layout

```
src/lib/peaklists/  peak-list reading (four formats), the assignment and its check, project inputs and uploads
src/lib/assignment.ts  assignment result types (spin systems, residues, links, consistency)
src/lib/artina/     catalogue, downloads, import jobs, cube cache, plane/strip extraction
src/lib/spectra/    NdCube, NMRPipe/UCSF readers, peak-list parsers, experiment types
src/lib/structure/  PDB reader, structure neighbours, chemical shift index, BMRB averages
src/lib/bruker/     Bruker 1D processing and line fitting
src/lib/project/    project store (.data/projects), actions (also the agent's tools), view model
src/lib/export.ts   NMR-STAR, Sparky and table exports
src/lib/agent/      Claude tool-use loop and system prompt
src/lib/landing/    data for the landing page's 3D story (from the ubiquitin demo)
src/app/api/        projects, uploads, actions, chat (SSE), export, spectra planes/strips, ARTINA, Bruker
src/components/     shell, sequence, panels, spectrum, structure (three.js), chat, landing
```

`/dev/bruker` is a component harness, available in development only.
