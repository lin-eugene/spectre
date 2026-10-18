"use client";
// Fixed, full-viewport three.js canvas behind the landing page. The scroll position is mapped
// onto the story (act index + progress through it) from the sections marked data-act="…", and
// each section's data-side (where its text sits) pushes the 3D subject to the other half of the
// screen. three.js and the scene are loaded after first paint; without WebGL the page still works.
import { useEffect, useRef } from "react";
import { LANDING_ACTS, type LandingSceneData } from "@/lib/landing/types";
import type { StoryEngine } from "./story/engine";

export interface StoryCanvasProps {
  data: LandingSceneData;
}

const SIDE_SHIFT: Record<string, number> = { left: 1, right: -1, center: 0 };
const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

interface ActAnchor {
  start: number; // scrollY at which the act begins
  end: number; // … and ends
  shift: number;
}

/**
 * An act runs while the viewport centre is inside its section; across solid sections between two
 * acts the story holds at the end of the earlier one.
 */
function readAnchors(): ActAnchor[] {
  const vh = window.innerHeight;
  const maxScroll = Math.max(1, document.documentElement.scrollHeight - vh);
  const anchors: ActAnchor[] = [];
  LANDING_ACTS.forEach((act, i) => {
    const el = document.querySelector<HTMLElement>(`[data-act="${act}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const start = i === 0 ? 0 : Math.max(0, r.top + window.scrollY - vh / 2);
    const end = Math.min(r.bottom + window.scrollY - vh / 2, maxScroll);
    anchors[i] = { start, end: Math.max(start + 1, end), shift: SIDE_SHIFT[el.dataset.side ?? "center"] ?? 0 };
  });
  return anchors;
}

function storyPosition(anchors: ActAnchor[], y: number): { s: number; shift: number } {
  const n = LANDING_ACTS.length;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const a = anchors[i];
    if (!a || y < a.start) break;
    s = i + Math.min(1, (y - a.start) / (a.end - a.start));
  }
  // subject side: hold each act's side, cross-fade around the act boundaries
  const i = Math.min(n - 1, Math.floor(s));
  const f = s - i;
  const here = anchors[i]?.shift ?? 0;
  const prev = anchors[i - 1]?.shift ?? here;
  const next = anchors[i + 1]?.shift ?? here;
  let shift = here;
  if (f < 0.15) shift = prev + (here - prev) * smooth((f + 0.15) / 0.3);
  else if (f > 0.85) shift = here + (next - here) * smooth((f - 0.85) / 0.3);
  return { s, shift };
}

export default function StoryCanvas({ data }: StoryCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let engine: StoryEngine | null = null;
    let disposed = false;
    let raf = 0;
    let lost = false;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mobile = window.matchMedia("(max-width: 899px)").matches;
    let anchors: ActAnchor[] = [];
    let current = { s: 0, shift: 0 };
    let needsResize = true;
    let lastT = performance.now();
    let rendered = false;

    const resize = () => {
      if (!engine) return;
      const dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2);
      engine.resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, dpr);
      anchors = readAnchors();
      needsResize = false;
      rendered = false;
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!engine || lost || document.hidden) return;
      if (needsResize) resize();
      const dt = Math.min(0.1, (now - lastT) / 1000);
      lastT = now;
      // re-read section positions every frame: cheap, and robust to fonts/images shifting layout
      anchors = readAnchors();
      const target = storyPosition(anchors, window.scrollY);
      if (reduced) current = target;
      else {
        const k = 1 - Math.exp(-dt * 7);
        current = { s: current.s + (target.s - current.s) * k, shift: current.shift + (target.shift - current.shift) * k };
      }
      // reduced motion: no idle drift, so only draw when the story moves
      if (reduced && rendered && Math.abs(target.s - current.s) < 1e-4) return;
      engine.render(current.s, current.shift, now / 1000);
      rendered = true;
    };

    const onResize = () => {
      needsResize = true;
    };
    const onLost = (e: Event) => {
      e.preventDefault();
      lost = true;
    };
    const onRestored = () => {
      // simplest robust recovery: rebuild the scene on the restored context
      if (disposed) return;
      engine?.dispose();
      engine = null;
      lost = false;
      void start();
    };

    const start = async () => {
      const { StoryEngine } = await import("./story/engine");
      if (disposed) return;
      try {
        engine = new StoryEngine(canvas, data, { mobile, reducedMotion: reduced });
      } catch {
        return; // no WebGL: the landing page reads fine without its backdrop
      }
      needsResize = true;
      current = storyPosition(readAnchors(), window.scrollY);
      canvas.dataset.ready = "true";
      canvas.style.opacity = "1";
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    };

    window.addEventListener("resize", onResize);
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    void start();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      engine?.dispose();
      engine = null;
    };
  }, [data]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="story-canvas"
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: 0,
        pointerEvents: "none",
        display: "block",
        opacity: 0,
        transition: "opacity 900ms ease",
      }}
    />
  );
}
