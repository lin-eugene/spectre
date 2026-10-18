// Builds data/artina/catalog.json from https://nmrdb.ethz.ch/ — the ARTINA 100-protein NMR
// spectra dataset (Klukowski, Damberger, Allain, Iwai, Kadavath, Ramelot, Montelione, Riek,
// Güntert; CC BY 4.0). Only metadata and links are stored; spectra are downloaded on import.
// Run: node scripts/build-artina-catalog.mjs [saved-page.html]
import fs from "node:fs";
import path from "node:path";

const BASE = "https://nmrdb.ethz.ch/";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const out = path.join(root, "data/artina/catalog.json");

const decode = (s) =>
  s
    .replace(/&times;/g, "×")
    .replace(/&ndash;/g, "–")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
const strip = (s) => decode(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
const links = (cell) => Object.fromEntries([...cell.matchAll(/<a href='([^']+)'[^>]*>([^<]+)<\/a>/g)].map((m) => [m[2].trim(), BASE + m[1]]));

const html = process.argv[2] ? fs.readFileSync(process.argv[2], "utf8") : await (await fetch(BASE)).text();
const starts = [...html.matchAll(/<a name='/g)].map((m) => m.index);
const proteins = [];
for (let k = 0; k < starts.length; k++) {
  const sec = html.slice(starts[k], k + 1 < starts.length ? starts[k + 1] : html.length);
  const head = sec.match(/^<a name='([^']+)'><\/a>([\s\S]*?)\((\d+) residues/);
  if (!head) continue;
  const id = strip(head[2]).split(/\s+/)[0] || head[1];
  const pdb = sec.match(/rcsb\.org\/structure\/([0-9A-Za-z]{4})/);
  const bmrb = sec.match(/bmrbId=(\d+)/);
  const year = sec.match(/BMRB<\/a>, (\d{4})\)/);
  const ref = sec.match(/<b>Reference:<\/b><br>\s*([\s\S]*?)\s*<\/p>/);
  const others = Object.fromEntries(
    [...sec.matchAll(/href='(ARTINA_NMR_spectra_dataset\/\/[^']+\/others\/[^']+)'/g)].map((m) => [m[1].split("/").pop(), BASE + m[1]]),
  );
  const spectra = [];
  for (const row of sec.matchAll(/<tr>\s*<td>(\d+)<\/td>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (cells.length < 9) continue;
    const mb = parseFloat(strip(cells[4]));
    const count = (c) => strip(c).split(/\s+/)[0] || "";
    spectra.push({
      index: parseInt(row[1], 10),
      type: strip(cells[0].replace(/<br>[\s\S]*/, "")),
      size: strip(cells[1]),
      ppm: strip(cells[2].replace(/<br>/g, " | ")),
      freq: strip(cells[3]),
      mb: Number.isFinite(mb) ? mb : null,
      files: links(cells[0]),
      expected: links(cells[6]),
      assigned: links(cells[7]),
      nExpected: count(cells[6]),
      nAssigned: count(cells[7]),
      pctAssigned: strip(cells[8]),
    });
  }
  proteins.push({
    anchor: head[1],
    id,
    residues: parseInt(head[3], 10),
    pdb: pdb ? pdb[1] : null,
    bmrb: bmrb ? bmrb[1] : null,
    year: year ? year[1] : null,
    reference: ref ? strip(ref[1]) : null,
    others,
    spectra,
  });
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(
  out,
  JSON.stringify({
    source: BASE,
    title: "The 100-protein NMR spectra dataset: A resource for biomolecular NMR data analysis (ARTINA)",
    authors: "Klukowski P, Damberger FF, Allain FH-T, Iwai H, Kadavath H, Ramelot TA, Montelione GT, Riek R, Güntert P",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    fetched: new Date().toISOString().slice(0, 10),
    proteins,
  }),
);
console.log(`${proteins.length} proteins, ${proteins.reduce((s, p) => s + p.spectra.length, 0)} spectra → ${path.relative(root, out)} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
