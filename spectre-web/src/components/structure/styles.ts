// Styles for the structure panel, injected once via a hoisted <style> (React 19).
// (CSS modules are not used: the Tailwind turbopack rule in next.config processes all *.css as global.)
export const STRUCTURE_CSS = `
.sv-root {
  --sv-bg: #ffffff;
  --sv-fg: #172033;
  --sv-muted: #667085;
  --sv-border: rgba(15, 23, 42, 0.1);
  --sv-btn: rgba(246, 247, 249, 0.92);
  --sv-btn-hover: #eceff3;
  --sv-btn-fg: #3b4554;
  --sv-active-bg: #e7f0ff;
  --sv-active-fg: #0053d6;
  --sv-card: rgba(255, 255, 255, 0.97);
  --sv-chip: #f1f3f6;
  --sv-accent: #12b886;
  --sv-mono: var(--font-geist-mono, ui-monospace, "SFMono-Regular", Menlo, monospace);
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 340px;
  background: var(--sv-bg);
  color: var(--sv-fg);
  overflow: hidden;
  isolation: isolate;
  font-variant-numeric: tabular-nums;
  -webkit-user-select: none;
  user-select: none;
}

.dark .sv-root,
[data-theme="dark"] .sv-root {
  --sv-bg: #0e1117;
  --sv-fg: #e6e9ef;
  --sv-muted: #98a2b3;
  --sv-border: rgba(255, 255, 255, 0.1);
  --sv-btn: rgba(30, 34, 42, 0.9);
  --sv-btn-hover: #2a303a;
  --sv-btn-fg: #cfd5df;
  --sv-active-bg: #16305c;
  --sv-active-fg: #8ab4ff;
  --sv-card: rgba(22, 26, 33, 0.97);
  --sv-chip: #232934;
}

@media (prefers-color-scheme: dark) {
  html:not([data-theme="light"]):not(.light) .sv-root {
    --sv-bg: #0e1117;
    --sv-fg: #e6e9ef;
    --sv-muted: #98a2b3;
    --sv-border: rgba(255, 255, 255, 0.1);
    --sv-btn: rgba(30, 34, 42, 0.9);
    --sv-btn-hover: #2a303a;
    --sv-btn-fg: #cfd5df;
    --sv-active-bg: #16305c;
    --sv-active-fg: #8ab4ff;
    --sv-card: rgba(22, 26, 33, 0.97);
    --sv-chip: #232934;
  }
}

.sv-canvas-host {
  position: absolute;
  inset: 0;
  cursor: grab;
}

.sv-canvas-host:active {
  cursor: grabbing;
}

.sv-hovering {
  cursor: pointer;
}

/* ------------------------------------------------------------- toolbar */
.sv-toolbar {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  z-index: 4;
}

.sv-btn {
  position: relative;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  border: 1px solid var(--sv-border);
  background: var(--sv-btn);
  color: var(--sv-btn-fg);
  cursor: pointer;
  padding: 0;
  backdrop-filter: blur(6px);
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
}

.sv-btn:hover {
  background: var(--sv-btn-hover);
}

.sv-btn:active {
  transform: scale(0.96);
}

.sv-btn:focus-visible {
  outline: 2px solid var(--sv-active-fg);
  outline-offset: 2px;
}

.sv-btn-active {
  background: var(--sv-active-bg);
  color: var(--sv-active-fg);
  border-color: color-mix(in srgb, var(--sv-active-fg) 35%, transparent);
}

.sv-btn[data-tip]:hover::after {
  content: attr(data-tip);
  position: absolute;
  right: calc(100% + 8px);
  top: 50%;
  transform: translateY(-50%);
  white-space: nowrap;
  font-size: 11.5px;
  font-weight: 500;
  color: #fff;
  background: #1f2937;
  border-radius: 6px;
  padding: 4px 8px;
  pointer-events: none;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
}

.sv-btn[data-open="true"]::after {
  display: none;
}

.sv-menu {
  position: absolute;
  right: 44px;
  min-width: 250px;
  background: var(--sv-card);
  border: 1px solid var(--sv-border);
  border-radius: 12px;
  box-shadow: 0 16px 40px -12px rgba(16, 24, 40, 0.32), 0 2px 6px rgba(16, 24, 40, 0.08);
  padding: 6px;
  z-index: 5;
  animation: pop 0.14s ease-out;
}

@keyframes pop {
  from {
    opacity: 0;
    transform: translateX(6px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.sv-menu-title {
  font-size: 10.5px;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--sv-muted);
  padding: 6px 8px 4px;
  font-weight: 600;
}

.sv-menu-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 7px 8px;
  border-radius: 8px;
  font: inherit;
  font-size: 13px;
  text-align: left;
  background: none;
  border: 0;
  color: var(--sv-fg);
  cursor: pointer;
}

.sv-menu-item:hover {
  background: var(--sv-chip);
}

.sv-menu-item-active {
  color: var(--sv-active-fg);
  font-weight: 600;
}

.sv-menu-check {
  margin-left: auto;
  display: grid;
  place-items: center;
}

.sv-menu-divider {
  height: 1px;
  background: var(--sv-border);
  margin: 5px 4px;
}

.sv-swatches {
  display: inline-flex;
  gap: 2px;
  width: 46px;
  flex: none;
}

.sv-swatch {
  width: 9px;
  height: 12px;
  border-radius: 2px;
  box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.12);
}

.sv-rep-icon {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: var(--sv-chip);
  display: grid;
  place-items: center;
  font-size: 11px;
  color: var(--sv-muted);
}

/* ------------------------------------------------------------- overlay */
.sv-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 3;
}

.sv-leader {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.sv-card {
  position: absolute;
  left: 0;
  top: 0;
  width: 252px;
  background: var(--sv-card);
  border: 1px solid var(--sv-border);
  border-radius: 12px;
  box-shadow: 0 12px 32px -10px rgba(16, 24, 40, 0.3), 0 2px 6px rgba(16, 24, 40, 0.08);
  padding: 10px 12px 10px;
  font-size: 12.5px;
  line-height: 1.35;
  color: var(--sv-fg);
  will-change: transform;
  backdrop-filter: blur(8px);
}

.sv-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sv-element-dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  flex: none;
  box-shadow: inset 0 -1.5px 2px rgba(0, 0, 0, 0.25), 0 0 0 2px color-mix(in srgb, currentColor 0%, transparent);
}

.sv-atom-title {
  font-size: 16px;
  font-weight: 650;
  letter-spacing: -0.01em;
}

.sv-code {
  font-family: var(--sv-mono);
  font-size: 10.5px;
  color: var(--sv-muted);
  background: var(--sv-chip);
  border-radius: 4px;
  padding: 1px 5px;
}

.sv-role {
  margin-left: auto;
  font-size: 11px;
  color: var(--sv-muted);
  font-weight: 500;
  white-space: nowrap;
}

.sv-res-line {
  margin-top: 3px;
  color: var(--sv-fg);
  font-weight: 550;
  display: flex;
  align-items: center;
  gap: 6px;
}

.sv-res-line .sv-muted {
  font-weight: 400;
}

.sv-divider {
  height: 1px;
  background: var(--sv-border);
  margin: 8px 0 7px;
}

.sv-shift-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.sv-shift-nucleus {
  font-size: 11.5px;
  color: var(--sv-muted);
}

.sv-shift-value {
  font-family: var(--sv-mono);
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.sv-unit {
  font-size: 11px;
  color: var(--sv-muted);
  margin-left: 3px;
  font-weight: 400;
}

.sv-tag {
  font-size: 10px;
  padding: 1px 7px;
  border-radius: 999px;
  font-weight: 650;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.sv-tag-assigned {
  background: #e3f6ee;
  color: #087f5b;
}

.sv-tag-none {
  background: var(--sv-chip);
  color: var(--sv-muted);
}

.sv-muted {
  color: var(--sv-muted);
}

.sv-expected {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--sv-muted);
}

.sv-mono {
  font-family: var(--sv-mono);
}

.sv-meta-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  margin-top: 7px;
  font-size: 12px;
}

.sv-meta-key {
  color: var(--sv-muted);
}

.sv-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.sv-square {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  flex: none;
}

/* labels for the selected residue */
.sv-atom-label {
  position: absolute;
  left: 0;
  top: 0;
  font-family: var(--sv-mono);
  font-size: 10px;
  font-weight: 600;
  color: #0b5e46;
  background: color-mix(in srgb, var(--sv-card) 88%, transparent);
  border: 1px solid rgba(18, 184, 134, 0.5);
  border-radius: 5px;
  padding: 0 4px;
  white-space: nowrap;
  will-change: transform;
}

.dark .sv-atom-label,
[data-theme="dark"] .sv-atom-label {
  color: #63e6be;
}

.sv-res-label {
  position: absolute;
  left: 0;
  top: 0;
  font-size: 12px;
  font-weight: 650;
  color: #fff;
  background: var(--sv-accent);
  border-radius: 999px;
  padding: 3px 10px;
  white-space: nowrap;
  box-shadow: 0 6px 16px -6px rgba(18, 184, 134, 0.8);
  will-change: transform;
}

/* ------------------------------------------------------------- chrome */
.sv-legend {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 3;
  background: color-mix(in srgb, var(--sv-card) 92%, transparent);
  border: 1px solid var(--sv-border);
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 11.5px;
  backdrop-filter: blur(6px);
  max-width: min(260px, calc(100% - 80px));
  pointer-events: none;
}

.sv-legend-title {
  font-weight: 650;
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--sv-muted);
  margin-bottom: 5px;
}

.sv-legend-row {
  display: flex;
  align-items: center;
  gap: 7px;
  line-height: 1.55;
}

.sv-ramp {
  width: 160px;
  max-width: 100%;
  height: 8px;
  border-radius: 4px;
  margin: 3px 0 2px;
}

.sv-ramp-labels {
  display: flex;
  justify-content: space-between;
  color: var(--sv-muted);
  font-size: 10.5px;
}

.sv-footer {
  position: absolute;
  bottom: 10px;
  right: 12px;
  z-index: 3;
  font-size: 11px;
  color: var(--sv-muted);
  pointer-events: none;
  text-align: right;
}

.sv-hint {
  position: absolute;
  bottom: 14px;
  left: 84px;
  z-index: 3;
  font-size: 11.5px;
  color: var(--sv-muted);
  pointer-events: none;
  transition: opacity 0.4s ease;
  white-space: nowrap;
}

.sv-empty,
.sv-loading {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--sv-muted);
  font-size: 13px;
  text-align: center;
  z-index: 2;
  padding: 24px;
}

.sv-loading-dots {
  display: inline-flex;
  gap: 5px;
  margin-bottom: 8px;
}

.sv-loading-dots span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #65cbf3;
  animation: blink 1s infinite ease-in-out;
}

.sv-loading-dots span:nth-child(2) {
  animation-delay: 0.15s;
  background: #0053d6;
}

.sv-loading-dots span:nth-child(3) {
  animation-delay: 0.3s;
  background: #ffdb13;
}

@keyframes blink {
  0%,
  100% {
    opacity: 0.25;
    transform: translateY(0);
  }
  50% {
    opacity: 1;
    transform: translateY(-3px);
  }
}

@media (max-width: 520px) {
  .sv-hint {
    display: none;
  }
  .sv-card {
    width: 216px;
    font-size: 12px;
  }
  .sv-btn {
    width: 32px;
    height: 32px;
  }
}
`;

export const S = {
  atomLabel: "sv-atom-label",
  atomTitle: "sv-atom-title",
  btn: "sv-btn",
  btnActive: "sv-btn-active",
  canvasHost: "sv-canvas-host",
  card: "sv-card",
  cardHead: "sv-card-head",
  chip: "sv-chip",
  code: "sv-code",
  divider: "sv-divider",
  elementDot: "sv-element-dot",
  empty: "sv-empty",
  expected: "sv-expected",
  footer: "sv-footer",
  hint: "sv-hint",
  hovering: "sv-hovering",
  leader: "sv-leader",
  legend: "sv-legend",
  legendRow: "sv-legend-row",
  legendTitle: "sv-legend-title",
  loading: "sv-loading",
  loadingDots: "sv-loading-dots",
  menu: "sv-menu",
  menuCheck: "sv-menu-check",
  menuDivider: "sv-menu-divider",
  menuItem: "sv-menu-item",
  menuItemActive: "sv-menu-item-active",
  menuTitle: "sv-menu-title",
  metaGrid: "sv-meta-grid",
  metaKey: "sv-meta-key",
  mono: "sv-mono",
  muted: "sv-muted",
  overlay: "sv-overlay",
  ramp: "sv-ramp",
  rampLabels: "sv-ramp-labels",
  repIcon: "sv-rep-icon",
  resLabel: "sv-res-label",
  resLine: "sv-res-line",
  role: "sv-role",
  root: "sv-root",
  shiftNucleus: "sv-shift-nucleus",
  shiftRow: "sv-shift-row",
  shiftValue: "sv-shift-value",
  square: "sv-square",
  swatch: "sv-swatch",
  swatches: "sv-swatches",
  tag: "sv-tag",
  tagAssigned: "sv-tag-assigned",
  tagNone: "sv-tag-none",
  toolbar: "sv-toolbar",
  unit: "sv-unit",
} as const;
