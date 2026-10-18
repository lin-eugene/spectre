"use client";
// Shared chart parts: axes overlay, tooltip, colour bar, legend and table view.
import { useEffect, useId, useRef, type ReactNode } from "react";
import { CONFIDENCE, type Confidence } from "@/lib/contract";
import { formatTick, niceTicks, tickStep } from "@/lib/viz/ticks";
import { styles } from "./styles";

export interface PlotRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface AxisSpec {
  /** value at the left (x) or top (y) edge, and at the right/bottom edge */
  from: number;
  to: number;
  title: string;
  ticks?: { value: number; label: string }[];
  count?: number;
}

function autoTicks(a: AxisSpec, count: number) {
  if (a.ticks) return a.ticks;
  const step = tickStep(a.from, a.to, count);
  return niceTicks(a.from, a.to, count).map((v) => ({ value: v, label: formatTick(v, step) }));
}

export function Axes({ total, plot, x, y }: { total: { width: number; height: number }; plot: PlotRect; x: AxisSpec; y: AxisSpec }) {
  const xt = autoTicks(x, x.count ?? Math.max(3, Math.round(plot.width / 80)));
  const yt = autoTicks(y, y.count ?? Math.max(3, Math.round(plot.height / 60)));
  const px = (v: number) => plot.left + ((v - x.from) / (x.to - x.from)) * plot.width;
  const py = (v: number) => plot.top + ((v - y.from) / (y.to - y.from)) * plot.height;
  const bottom = plot.top + plot.height;
  return (
    <svg className={styles.axes} width={total.width} height={total.height} aria-hidden="true">
      <rect className={styles.frame} x={plot.left + 0.5} y={plot.top + 0.5} width={plot.width - 1} height={plot.height - 1} />
      {xt.map((t) => {
        const X = Math.round(px(t.value)) + 0.5;
        if (X < plot.left - 0.5 || X > plot.left + plot.width + 0.5) return null;
        return (
          <g key={`x${t.value}`}>
            <line className={styles.tickLine} x1={X} x2={X} y1={bottom} y2={bottom + 5} />
            <text className={styles.tickText} x={X} y={bottom + 18} textAnchor="middle">
              {t.label}
            </text>
          </g>
        );
      })}
      {yt.map((t) => {
        const Y = Math.round(py(t.value)) + 0.5;
        if (Y < plot.top - 0.5 || Y > bottom + 0.5) return null;
        return (
          <g key={`y${t.value}`}>
            <line className={styles.tickLine} x1={plot.left - 5} x2={plot.left} y1={Y} y2={Y} />
            <text className={styles.tickText} x={plot.left - 8} y={Y + 3.5} textAnchor="end">
              {t.label}
            </text>
          </g>
        );
      })}
      <text className={styles.axisTitle} x={plot.left + plot.width / 2} y={bottom + 38} textAnchor="middle">
        {x.title}
      </text>
      <text
        className={styles.axisTitle}
        transform={`translate(${Math.max(12, plot.left - 46)}, ${plot.top + plot.height / 2}) rotate(-90)`}
        textAnchor="middle"
      >
        {y.title}
      </text>
    </svg>
  );
}

export interface TooltipState {
  x: number;
  y: number;
  flip: boolean;
  color?: string;
  title: string;
  rows: [string, string][];
  foot?: string;
}

export function Tooltip({ t }: { t: TooltipState | null }) {
  if (!t) return null;
  return (
    <div className={`${styles.tooltip} ${t.flip ? styles.flip : ""}`} style={{ left: t.x, top: t.y }} role="status" aria-live="polite">
      <div className={styles.ttHead}>
        {t.color && <span className={styles.ttDot} style={{ background: t.color }} />}
        <span>{t.title}</span>
      </div>
      <div className={styles.ttRows}>
        {t.rows.map(([k, v], i) => (
          <div key={i} style={{ display: "contents" }}>
            <span className={styles.ttLabel}>{k}</span>
            <span className={styles.ttValue}>{v}</span>
          </div>
        ))}
      </div>
      {t.foot && <div className={styles.ttFoot}>{t.foot}</div>}
    </div>
  );
}

export function Colorbar({ stops, width, title, ticks }: { stops: string[]; width: number; title: string; ticks: { at: number; label: string }[] }) {
  const h = 12;
  const gid = `cb${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <div className={styles.colorbar} style={{ width }}>
      <svg width={width} height={h + 20} aria-hidden="true" style={{ overflow: "visible" }}>
        <defs>
          <linearGradient id={gid} x1="0" x2="1" y1="0" y2="0">
            {stops.map((s, i) => (
              <stop key={i} offset={i / (stops.length - 1)} stopColor={s} />
            ))}
          </linearGradient>
        </defs>
        <rect x={0.5} y={0.5} width={width - 1} height={h} rx={3} fill={`url(#${gid})`} stroke="var(--spx-axis)" strokeWidth={1} />
        {ticks.map((t) => {
          const X = 0.5 + t.at * (width - 1);
          return (
            <g key={t.label}>
              <line x1={X} x2={X} y1={h + 1} y2={h + 5} stroke="var(--spx-axis)" />
              <text x={X} y={h + 17} textAnchor="middle" className={styles.tickText}>
                {t.label}
              </text>
            </g>
          );
        })}
      </svg>
      <span className={styles.colorbarTitle}>{title}</span>
    </div>
  );
}

export const CONF_ORDER: Confidence[] = ["veryHigh", "high", "low", "unassigned"];

export function ConfidenceLegend({ title, extras, labels }: { title?: string; extras?: ReactNode; labels?: Partial<Record<Confidence, string>> }) {
  return (
    <div className={styles.legend} role="list" aria-label={title ?? "Peak colour"}>
      {title && <span style={{ color: "var(--spx-muted)" }}>{title}</span>}
      {CONF_ORDER.map((c) => (
        <span key={c} className={styles.legendItem} role="listitem">
          <span className={styles.legendDot} style={{ background: CONFIDENCE[c].color }} />
          {labels?.[c] ?? CONFIDENCE[c].label}
        </span>
      ))}
      {extras}
    </div>
  );
}

export function Caption({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.caption}>
      <h3 className={styles.captionTitle}>{title}</h3>
      <p className={styles.captionText}>{children}</p>
    </div>
  );
}

export interface TableColumn<T> {
  key: string;
  label: string;
  num?: boolean;
  render: (row: T) => ReactNode;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  selected,
  onRow,
  caption,
}: {
  rows: T[];
  columns: TableColumn<T>[];
  rowKey: (r: T) => string;
  selected?: (r: T) => boolean;
  onRow?: (r: T) => void;
  caption: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const selectedKey = rows
    .filter((r) => selected?.(r))
    .map(rowKey)
    .join(",");
  useEffect(() => {
    // bring the selected row into view inside the table's own scroll box (never scroll the page)
    const wrap = wrapRef.current;
    const tr = wrap?.querySelector<HTMLTableRowElement>('tr[data-selected="true"]');
    if (!wrap || !tr) return;
    const top = tr.offsetTop;
    if (top < wrap.scrollTop + 36 || top > wrap.scrollTop + wrap.clientHeight - 36) wrap.scrollTop = Math.max(0, top - wrap.clientHeight / 2);
  }, [selectedKey]);
  return (
    <div ref={wrapRef} className={styles.tableWrap}>
      <table className={styles.table}>
        <caption style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.num ? styles.num : undefined} scope="col">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={rowKey(r)}
              data-selected={selected?.(r) ? "true" : "false"}
              onClick={() => onRow?.(r)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onRow?.(r);
                }
              }}
            >
              {columns.map((c) => (
                <td key={c.key} className={c.num ? styles.num : undefined}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Swatch({ color }: { color: string }) {
  return <span className={styles.legendDot} style={{ background: color, display: "inline-block" }} />;
}
