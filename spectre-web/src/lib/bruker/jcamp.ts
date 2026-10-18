// Bruker JCAMP-DX parameter files (acqus, procs, acqu2s, ...).
// "##$KEY= value" lines; array values are written as "##$KEY= (0..n)" followed by
// whitespace-separated values on the next line(s); strings are wrapped in <...>.

export type ParamValue = string | number | number[] | string[];

function scalar(v: string): string | number {
  const t = v.trim();
  if (t.startsWith("<") && t.endsWith(">")) return t.slice(1, -1);
  if (t !== "" && !Number.isNaN(Number(t))) return Number(t);
  return t;
}

export function parseBrukerParams(text: string): Record<string, string | number | number[]> {
  const out: Record<string, ParamValue> = {};
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^##\$?([^=]+)=\s?(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    const val = m[2];
    const arr = val.trim().match(/^\((\d+)\.\.(\d+)\)\s*(.*)$/);
    if (arr) {
      const count = parseInt(arr[2], 10) - parseInt(arr[1], 10) + 1;
      const items: string[] = [];
      let rest = arr[3].trim();
      if (rest) items.push(...tokenize(rest));
      while (items.length < count && i + 1 < lines.length && !lines[i + 1].startsWith("##")) {
        i++;
        rest = lines[i].trim();
        if (rest.startsWith("$$")) continue;
        items.push(...tokenize(rest));
      }
      const vals = items.map(scalar);
      out[key] = vals.every((x) => typeof x === "number") ? (vals as number[]) : (vals.map(String) as string[]);
      continue;
    }
    if (val.trim().startsWith("<") && !val.trim().endsWith(">")) {
      // multi-line string
      let s = val.trim();
      while (i + 1 < lines.length && !s.endsWith(">")) {
        i++;
        s += "\n" + lines[i];
      }
      out[key] = s.slice(1, -1);
      continue;
    }
    out[key] = scalar(val);
  }
  return out as Record<string, string | number | number[]>;
}

function tokenize(s: string): string[] {
  const out: string[] = [];
  const re = /<[^>]*>|\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push(m[0]);
  return out;
}

export function num(p: Record<string, unknown>, key: string, fallback: number): number {
  const v = p[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return fallback;
}

export function str(p: Record<string, unknown>, key: string, fallback = ""): string {
  const v = p[key];
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : fallback;
}
