// Minimal, safe markdown renderer for assistant messages (no HTML passthrough):
// paragraphs, headings, lists, fenced code, tables, **bold**, *italic*, `code`, [links](url).
import { Fragment, type ReactNode } from "react";

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // emphasis markers inside words (e.g. ANTHROPIC_API_KEY) are literal, as in CommonMark
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|((?<![\w])__[^_]+__(?![\w]))|((?<![\w*])\*[^*\s][^*]*?\*(?![\w*]))|((?<![\w])_[^_\s][^_]*?_(?![\w]))|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${k++}`;
    if (tok.startsWith("`")) {
      out.push(
        <code key={key} className="rounded bg-surface-3 px-1 py-[1px] font-mono text-[0.86em] text-fg">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("**") || tok.startsWith("__")) {
      out.push(
        <strong key={key} className="font-semibold text-fg">
          {inline(tok.slice(2, -2), key)}
        </strong>,
      );
    } else if (tok.startsWith("[")) {
      const mm = tok.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      const href = mm?.[2] ?? "#";
      const safe = /^(https?:|mailto:|#|\/)/i.test(href) ? href : "#";
      out.push(
        <a key={key} href={safe} target={safe.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className="text-accent underline-offset-2 hover:underline">
          {mm?.[1] ?? tok}
        </a>,
      );
    } else {
      out.push(<em key={key}>{inline(tok.slice(1, -1), key)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isTableSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const cells = (l: string) =>
  l
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let para: string[] = [];
  const flushPara = () => {
    if (!para.length) return;
    const key = `p${blocks.length}`;
    blocks.push(
      <p key={key} className="my-2 first:mt-0 last:mb-0">
        {para.map((l, j) => (
          <Fragment key={j}>
            {j > 0 && " "}
            {inline(l, `${key}-${j}`)}
          </Fragment>
        ))}
      </p>,
    );
    para = [];
  };
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flushPara();
      const lang = line.trim().slice(3).trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={`c${blocks.length}`} className="scroll-quiet my-2 overflow-x-auto rounded-md bg-surface-3 p-2.5 font-mono text-[11.5px] leading-relaxed text-fg" data-lang={lang || undefined}>
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flushPara();
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      const key = `t${blocks.length}`;
      blocks.push(
        <div key={key} className="scroll-quiet my-2 overflow-x-auto rounded-md border border-line">
          <table className="w-full border-collapse text-[12px]">
            <thead className="bg-surface-2">
              <tr>
                {head.map((h, j) => (
                  <th key={j} className="px-2 py-1 text-left font-semibold text-fg">
                    {inline(h, `${key}h${j}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-t border-line">
                  {r.map((c, j) => (
                    <td key={j} className="px-2 py-1 align-top text-fg">
                      {inline(c, `${key}r${ri}c${j}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushPara();
      blocks.push(
        <div key={`h${blocks.length}`} className={h[1].length <= 2 ? "mt-3 mb-1 text-[14px] font-semibold text-fg" : "mt-2.5 mb-1 text-[13px] font-semibold text-fg"}>
          {inline(h[2], `h${blocks.length}`)}
        </div>,
      );
      i++;
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      flushPara();
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
          items[items.length - 1] += " " + lines[i].trim();
          i++;
        }
      }
      const key = `l${blocks.length}`;
      const Tag = ordered ? "ol" : "ul";
      blocks.push(
        <Tag key={key} className={`my-2 space-y-0.5 pl-5 ${ordered ? "list-decimal" : "list-disc"} marker:text-faint`}>
          {items.map((it, j) => (
            <li key={j}>{inline(it, `${key}-${j}`)}</li>
          ))}
        </Tag>,
      );
      continue;
    }
    if (!line.trim()) {
      flushPara();
      i++;
      continue;
    }
    para.push(line.trim());
    i++;
  }
  flushPara();
  return <>{blocks}</>;
}
