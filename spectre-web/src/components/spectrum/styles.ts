// Panel styles as a plain stylesheet with an "spx-" prefix (rendered once by SpectrumPanel).
// Kept out of CSS modules because the project routes every .css file through the Tailwind
// Turbopack loader, which strips CSS-module semantics.
export const SPX_CSS = /* css */ `
.spx-root {
  --spx-dark: 0;
  --spx-pos: #1f8a3e;
  --spx-neg: #6250d6;
  --spx-rose: #d6336c;
  --spx-beam: #2c63b4;
  --spx-stage: radial-gradient(125% 100% at 50% 30%, #ffffff 0%, #f8f9fa 55%, #eef0f3 100%);
  --spx-surface: #ffffff;
  --spx-raised: #f6f7f8;
  --spx-ink: #0b0b0b;
  --spx-ink-2: #52514e;
  --spx-muted: #898781;
  --spx-grid: #ebeae5;
  --spx-axis: #c3c2b7;
  --spx-border: rgba(11, 11, 11, 0.1);
  --spx-accent: #0b0b0b;
  --spx-focus: #1a5fb4;
  --spx-tab-active: #0b0b0b;
  --spx-tooltip-bg: #ffffff;
  --spx-tooltip-shadow: 0 6px 24px rgba(15, 23, 42, 0.14), 0 1px 3px rgba(15, 23, 42, 0.1);
  color-scheme: light;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  min-width: 0;
  color: var(--spx-ink);
  background: var(--spx-surface);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.4;
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"]):not(.light)) .spx-root {
    --spx-dark: 1;
    --spx-pos: #3fae5a;
    --spx-neg: #9085e9;
    --spx-rose: #f06595;
    --spx-beam: #6fa4f1;
    --spx-stage: radial-gradient(125% 100% at 50% 30%, #252527 0%, #1d1d1f 55%, #151517 100%);
    --spx-surface: #1a1a19;
    --spx-raised: #232322;
    --spx-ink: #f0efec;
    --spx-ink-2: #c3c2b7;
    --spx-muted: #898781;
    --spx-grid: #2c2c2a;
    --spx-axis: #45453f;
    --spx-border: rgba(255, 255, 255, 0.1);
    --spx-accent: #f0efec;
    --spx-focus: #7fb0f5;
    --spx-tab-active: #f0efec;
    --spx-tooltip-bg: #262625;
    --spx-tooltip-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
    color-scheme: dark;
  }
}
:root[data-theme="dark"] .spx-root,
:root.dark .spx-root {
  --spx-dark: 1;
  --spx-pos: #3fae5a;
  --spx-neg: #9085e9;
  --spx-rose: #f06595;
  --spx-beam: #6fa4f1;
  --spx-stage: radial-gradient(125% 100% at 50% 30%, #252527 0%, #1d1d1f 55%, #151517 100%);
  --spx-surface: #1a1a19;
  --spx-raised: #232322;
  --spx-ink: #f0efec;
  --spx-ink-2: #c3c2b7;
  --spx-muted: #898781;
  --spx-grid: #2c2c2a;
  --spx-axis: #45453f;
  --spx-border: rgba(255, 255, 255, 0.1);
  --spx-accent: #f0efec;
  --spx-focus: #7fb0f5;
  --spx-tab-active: #f0efec;
  --spx-tooltip-bg: #262625;
  --spx-tooltip-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
  color-scheme: dark;
}
.spx-topbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 12px;
}
.spx-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 3px;
  border-radius: 10px;
  background: var(--spx-raised);
  box-shadow: inset 0 0 0 1px var(--spx-border);
}
.spx-tab {
  appearance: none;
  border: 0;
  margin: 0;
  background: transparent;
  color: var(--spx-ink-2);
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  padding: 5px 11px;
  border-radius: 7px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 120ms ease, color 120ms ease;
}
.spx-tab:hover {
  color: var(--spx-ink);
  background: color-mix(in srgb, var(--spx-ink) 6%, transparent);
}
.spx-tab[aria-selected="true"] {
  color: var(--spx-ink);
  background: var(--spx-surface);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08), 0 0 0 1px var(--spx-border);
}
.spx-tab:focus-visible,
.spx-chip:focus-visible,
.spx-iconButton:focus-visible,
.spx-plotFocus:focus-visible {
  outline: 2px solid var(--spx-focus);
  outline-offset: 2px;
}
.spx-tools {
  display: flex;
  align-items: center;
  gap: 6px;
}
.spx-iconButton {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  background: transparent;
  color: var(--spx-ink-2);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  padding: 5px 9px;
  border-radius: 7px;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px var(--spx-border);
}
.spx-iconButton:hover {
  color: var(--spx-ink);
  background: color-mix(in srgb, var(--spx-ink) 5%, transparent);
}
.spx-iconButton[aria-pressed="true"] {
  color: var(--spx-ink);
  background: color-mix(in srgb, var(--spx-ink) 8%, transparent);
}
.spx-iconButton svg {
  width: 14px;
  height: 14px;
}
.spx-subbar {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px 12px;
  color: var(--spx-ink-2);
  font-size: 12.5px;
}
.spx-subbar strong {
  color: var(--spx-ink);
  font-weight: 600;
}
.spx-stats {
  font-variant-numeric: tabular-nums;
  color: var(--spx-muted);
}
.spx-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.spx-chip {
  appearance: none;
  border: 0;
  font: inherit;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 999px;
  cursor: pointer;
  color: var(--spx-ink-2);
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--spx-border);
}
.spx-chip[aria-pressed="true"] {
  color: var(--spx-surface);
  background: var(--spx-ink);
  box-shadow: none;
}
.spx-figure {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.spx-plotWrap {
  position: relative;
  align-self: center;
  max-width: 100%;
}
.spx-plotFocus {
  position: absolute;
  border-radius: 2px;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
.spx-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
.spx-axes {
  position: absolute;
  inset: 0;
  overflow: visible;
  pointer-events: none;
  font-family: inherit;
}
.spx-tickText {
  fill: var(--spx-ink-2);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.spx-axisTitle {
  fill: var(--spx-ink);
  font-size: 12.5px;
  font-weight: 600;
}
.spx-tickLine {
  stroke: var(--spx-axis);
  stroke-width: 1;
  shape-rendering: crispEdges;
}
.spx-frame {
  fill: none;
  stroke: var(--spx-axis);
  stroke-width: 1;
  shape-rendering: crispEdges;
}
.spx-hint {
  position: absolute;
  right: 8px;
  top: 8px;
  font-size: 11px;
  color: var(--spx-muted);
  background: color-mix(in srgb, var(--spx-surface) 85%, transparent);
  padding: 2px 6px;
  border-radius: 6px;
  pointer-events: none;
  transition: opacity 200ms ease;
}
.spx-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  text-align: center;
  color: var(--spx-muted);
  font-size: 13px;
  padding: 24px;
  pointer-events: none;
}
.spx-tooltip {
  position: absolute;
  z-index: 5;
  min-width: 168px;
  max-width: 280px;
  padding: 9px 11px;
  border-radius: 10px;
  background: var(--spx-tooltip-bg);
  box-shadow: var(--spx-tooltip-shadow), 0 0 0 1px var(--spx-border);
  color: var(--spx-ink);
  font-size: 12px;
  pointer-events: none;
  transform: translate(14px, -50%);
}
.spx-tooltip.spx-flip {
  transform: translate(calc(-100% - 14px), -50%);
}
.spx-ttHead {
  display: flex;
  align-items: center;
  gap: 7px;
  font-weight: 600;
  margin-bottom: 6px;
}
.spx-ttDot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex: 0 0 auto;
  box-shadow: 0 0 0 1px var(--spx-border);
}
.spx-ttRows {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 12px;
  font-variant-numeric: tabular-nums;
}
.spx-ttValue {
  font-weight: 600;
  color: var(--spx-ink);
  text-align: right;
}
.spx-ttLabel {
  color: var(--spx-ink-2);
}
.spx-ttFoot {
  margin-top: 6px;
  color: var(--spx-muted);
  font-size: 11px;
}
.spx-below {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.spx-colorbar {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.spx-colorbarTitle {
  font-size: 12px;
  color: var(--spx-ink-2);
}
.spx-legend {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px 14px;
  font-size: 12px;
  color: var(--spx-ink-2);
}
.spx-legendItem {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.spx-legendDot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  box-shadow: 0 0 0 1px var(--spx-border);
}
.spx-legendLine {
  width: 16px;
  height: 0;
  border-top: 2px solid currentColor;
}
.spx-caption {
  margin: 4px 0 0;
  max-width: 62ch;
  align-self: flex-start;
}
.spx-captionTitle {
  margin: 0 0 4px;
  font-size: 18px;
  font-weight: 500;
  letter-spacing: -0.005em;
  color: var(--spx-ink);
}
.spx-captionText {
  margin: 0;
  font-size: 13.5px;
  color: var(--spx-ink-2);
}
.spx-captionText strong {
  color: var(--spx-ink);
  font-weight: 600;
}
.spx-tableWrap {
  max-height: 560px;
  overflow: auto;
  border-radius: 10px;
  box-shadow: inset 0 0 0 1px var(--spx-border);
}
.spx-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
}
.spx-table th {
  position: sticky;
  top: 0;
  background: var(--spx-raised);
  color: var(--spx-ink-2);
  font-weight: 600;
  text-align: left;
  padding: 7px 10px;
  border-bottom: 1px solid var(--spx-border);
}
.spx-table td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--spx-grid);
  color: var(--spx-ink);
}
.spx-table tr[data-selected="true"] td {
  background: color-mix(in srgb, var(--spx-ink) 7%, transparent);
}
.spx-table tbody tr {
  cursor: pointer;
}
.spx-table tbody tr:hover td {
  background: color-mix(in srgb, var(--spx-ink) 4%, transparent);
}
.spx-num {
  text-align: right;
}
.spx-swatchCell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.spx-stripHeads {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  pointer-events: none;
}
.spx-stripHead {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  pointer-events: auto;
  cursor: pointer;
  border-radius: 6px;
  padding: 2px 0 4px;
}
.spx-stripHead:hover {
  background: color-mix(in srgb, var(--spx-ink) 5%, transparent);
}
.spx-stripHead[data-selected="true"] {
  background: color-mix(in srgb, var(--spx-ink) 8%, transparent);
}
.spx-stripRes {
  font-weight: 650;
  font-size: 13px;
  color: var(--spx-ink);
}
.spx-stripRoot {
  font-size: 10.5px;
  color: var(--spx-muted);
  font-variant-numeric: tabular-nums;
}
.spx-stripBar {
  width: 70%;
  height: 4px;
  border-radius: 2px;
  margin-top: 2px;
}
@media (max-width: 520px) {
  .spx-tab {
    padding: 5px 8px;
    font-size: 12px;
  }
  .spx-captionTitle {
    font-size: 16px;
  }
}
.spx-planes {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.spx-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 8px 14px;
}
.spx-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.spx-fieldLabel {
  font-size: 11px;
  color: var(--spx-muted);
  letter-spacing: 0.01em;
}
.spx-select {
  appearance: auto;
  font: inherit;
  font-size: 12.5px;
  color: var(--spx-ink);
  background: var(--spx-surface);
  border: 0;
  box-shadow: inset 0 0 0 1px var(--spx-border);
  border-radius: 7px;
  padding: 5px 8px;
  max-width: 100%;
}
.spx-segmented {
  display: inline-flex;
  padding: 2px;
  gap: 2px;
  border-radius: 8px;
  background: var(--spx-raised);
  box-shadow: inset 0 0 0 1px var(--spx-border);
}
.spx-segmented button {
  appearance: none;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 12px;
  color: var(--spx-ink-2);
  padding: 4px 9px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
}
.spx-segmented button[aria-pressed="true"] {
  color: var(--spx-ink);
  background: var(--spx-surface);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08), 0 0 0 1px var(--spx-border);
}
.spx-segmented button:focus-visible,
.spx-select:focus-visible,
.spx-range:focus-visible {
  outline: 2px solid var(--spx-focus);
  outline-offset: 2px;
}
.spx-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--spx-ink-2);
  padding-bottom: 5px;
  cursor: pointer;
}
.spx-check input {
  accent-color: var(--spx-pos);
}
.spx-sliceBar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 10px;
  background: var(--spx-raised);
  box-shadow: inset 0 0 0 1px var(--spx-border);
}
.spx-range {
  flex: 1;
  min-width: 80px;
  accent-color: var(--spx-pos);
}
.spx-slicePpm {
  font-variant-numeric: tabular-nums;
  font-size: 12.5px;
  color: var(--spx-ink-2);
  white-space: nowrap;
  min-width: 9.5em;
  text-align: right;
}
.spx-slicePpm strong {
  color: var(--spx-ink);
  font-weight: 650;
}
.spx-emptyCard {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 8px;
  padding: 48px 24px;
  border-radius: 12px;
  color: var(--spx-ink-2);
  background: var(--spx-raised);
  box-shadow: inset 0 0 0 1px var(--spx-border);
}
.spx-emptyCard svg {
  color: var(--spx-pos);
}
.spx-emptyCard strong {
  color: var(--spx-ink);
  font-size: 15px;
}
.spx-emptyCard p {
  margin: 0;
  max-width: 46ch;
  font-size: 13px;
}
.spx-emptyCard a,
.spx-captionText a {
  color: var(--spx-focus);
  text-decoration: none;
  font-weight: 500;
}
.spx-emptyCard a:hover,
.spx-captionText a:hover {
  text-decoration: underline;
}
.spx-cube {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.spx-cubeBar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 8px 14px;
}
.spx-cubeBar > div {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 8px 14px;
}
.spx-cubeStage {
  position: relative;
  width: 100%;
  aspect-ratio: 100 / 84;
  min-height: 360px;
  max-height: 640px;
  border-radius: 12px;
  overflow: hidden;
  background: var(--spx-stage);
  box-shadow: inset 0 0 0 1px var(--spx-border);
  outline: none;
  user-select: none;
  -webkit-user-select: none;
}
.spx-cubeStage:focus-visible {
  box-shadow: inset 0 0 0 2px var(--spx-focus);
}
.spx-cubeCanvas {
  position: absolute;
  inset: 0;
  transition: opacity 420ms ease;
}
.spx-cubeSkeleton {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--spx-muted);
  font-size: 12.5px;
  pointer-events: none;
}
.spx-cubeSkeleton svg {
  stroke: var(--spx-axis);
  stroke-width: 1.4;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.spx-cubeSkeleton .spx-skFloor {
  stroke: color-mix(in srgb, var(--spx-pos) 55%, var(--spx-axis));
}
.spx-cubeSkeleton .spx-skStem {
  stroke: color-mix(in srgb, var(--spx-pos) 70%, transparent);
  stroke-width: 1.8;
  animation: spx-rise 1.6s ease-in-out infinite alternate;
}
@keyframes spx-rise {
  from {
    opacity: 0.25;
  }
  to {
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .spx-cubeSkeleton .spx-skStem {
    animation: none;
  }
  .spx-cubeCanvas {
    transition: none;
  }
}
.spx-cubeIdle {
  flex: 1;
  min-height: 26px;
  display: flex;
  align-items: center;
  font-size: 12.5px;
  color: var(--spx-muted);
}
.spx-cubeNotice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 14px;
  padding: 8px 12px;
  border-radius: 10px;
  font-size: 12.5px;
  color: var(--spx-ink-2);
  background: color-mix(in srgb, #ffdb13 12%, var(--spx-surface));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, #c9a800 30%, transparent);
}
.spx-cubeOverlay {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}
.spx-cubeOverlay > span {
  position: absolute;
  left: 0;
  top: 0;
  white-space: nowrap;
  will-change: transform;
}
.spx-cubeTick {
  font-size: 10.5px;
  color: var(--spx-ink-2);
  font-variant-numeric: tabular-nums;
  text-shadow: 0 0 3px var(--spx-surface), 0 0 2px var(--spx-surface);
}
.spx-cubeTitle {
  font-size: 12px;
  font-weight: 600;
  color: var(--spx-ink);
  text-shadow: 0 0 4px var(--spx-surface), 0 0 2px var(--spx-surface);
}
.spx-cubePeakLabel {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--spx-ink);
  padding: 1px 6px 1px 5px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--spx-surface) 84%, transparent);
  box-shadow: 0 0 0 1px var(--spx-border), 0 1px 3px rgba(0, 0, 0, 0.08);
}
.spx-cubePeakLabel.spx-cubeMain {
  font-weight: 700;
}
.spx-cubeTag {
  font-size: 11px;
  font-weight: 600;
  color: var(--spx-ink-2);
  text-shadow: 0 0 3px var(--spx-surface), 0 0 2px var(--spx-surface), 0 0 1px var(--spx-surface);
}
.spx-cubeHandle {
  font-size: 11px;
  font-weight: 650;
  color: var(--spx-rose);
  font-variant-numeric: tabular-nums;
  padding: 1px 6px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--spx-surface) 86%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--spx-rose) 35%, transparent);
}
.spx-cubeGizmo {
  font-size: 9.5px;
  font-weight: 650;
  color: var(--spx-muted);
}
.spx-cubeTip {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 5;
  pointer-events: none;
}
.spx-cubeTip .spx-tooltip {
  left: 0;
  top: 0;
}
.spx-cubeStatus {
  position: absolute;
  left: 10px;
  top: 10px;
  font-size: 11px;
  color: var(--spx-muted);
  background: color-mix(in srgb, var(--spx-surface) 85%, transparent);
  padding: 2px 7px;
  border-radius: 6px;
  pointer-events: none;
}
.spx-cubeFallback {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  text-align: center;
  padding: 24px;
  color: var(--spx-ink-2);
  font-size: 13px;
}
.spx-sphere {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.spx-iconButton.spx-square {
  padding: 5px 7px;
}
`;

export const styles = {
  axes: "spx-axes",
  axisTitle: "spx-axisTitle",
  below: "spx-below",
  canvas: "spx-canvas",
  caption: "spx-caption",
  captionText: "spx-captionText",
  captionTitle: "spx-captionTitle",
  chip: "spx-chip",
  chips: "spx-chips",
  colorbar: "spx-colorbar",
  colorbarTitle: "spx-colorbarTitle",
  empty: "spx-empty",
  figure: "spx-figure",
  flip: "spx-flip",
  frame: "spx-frame",
  hint: "spx-hint",
  iconButton: "spx-iconButton",
  legend: "spx-legend",
  legendDot: "spx-legendDot",
  legendItem: "spx-legendItem",
  legendLine: "spx-legendLine",
  num: "spx-num",
  plotFocus: "spx-plotFocus",
  plotWrap: "spx-plotWrap",
  root: "spx-root",
  stats: "spx-stats",
  stripBar: "spx-stripBar",
  stripHead: "spx-stripHead",
  stripHeads: "spx-stripHeads",
  stripRes: "spx-stripRes",
  stripRoot: "spx-stripRoot",
  subbar: "spx-subbar",
  swatchCell: "spx-swatchCell",
  tab: "spx-tab",
  table: "spx-table",
  tableWrap: "spx-tableWrap",
  tabs: "spx-tabs",
  tickLine: "spx-tickLine",
  tickText: "spx-tickText",
  tools: "spx-tools",
  tooltip: "spx-tooltip",
  topbar: "spx-topbar",
  ttDot: "spx-ttDot",
  ttFoot: "spx-ttFoot",
  ttHead: "spx-ttHead",
  ttLabel: "spx-ttLabel",
  ttRows: "spx-ttRows",
  ttValue: "spx-ttValue",
  planes: "spx-planes",
  controls: "spx-controls",
  field: "spx-field",
  fieldLabel: "spx-fieldLabel",
  select: "spx-select",
  segmented: "spx-segmented",
  check: "spx-check",
  sliceBar: "spx-sliceBar",
  range: "spx-range",
  slicePpm: "spx-slicePpm",
  emptyCard: "spx-emptyCard",
  cube: "spx-cube",
  cubeBar: "spx-cubeBar",
  cubeStage: "spx-cubeStage",
  cubeCanvas: "spx-cubeCanvas",
  cubeOverlay: "spx-cubeOverlay",
  cubeTip: "spx-cubeTip",
  cubeStatus: "spx-cubeStatus",
  cubeFallback: "spx-cubeFallback",
  sphere: "spx-sphere",
  cubeSkeleton: "spx-cubeSkeleton",
  cubeIdle: "spx-cubeIdle",
  cubeNotice: "spx-cubeNotice",
  square: "spx-square",
} as const;
