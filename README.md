# spectre (hackathon-20261017)

Hackathon project, 17 October 2026.

- `spectre-web/`: Spectre, the web app (Next.js). See its [README](spectre-web/README.md).

Spectre is a concept for a user interface that makes protein NMR assignment and analysis more
intuitive and easier for scientists. It shows a protein's backbone assignment, built from your 3D
spectra and their assigned peak lists, with a consistency check of every residue, the 3D
structure and an AI agent, all on one page.

## Status and next steps

Spectre is a UI concept, not yet a full assignment suite: it displays and checks assignments made
elsewhere, but does not pick peaks or assign spectra itself. To make it a functional assignment
suite, the next steps are:

- **Peak pickers**, so that peaks can be picked in the uploaded spectra instead of imported from
  other software.
- **An automated assignment backend**, so that picked peaks are assigned to the sequence
  automatically, with the consistency check and the views reused to review the result.

## Run

Needs Node.js 20.9+.

```sh
cd spectre-web
npm install
npm run dev            # http://localhost:3000
```

## License

[MIT](LICENSE)
