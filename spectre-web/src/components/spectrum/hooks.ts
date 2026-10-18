"use client";
import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

const useIso = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Width of an element, tracked with ResizeObserver. */
export function useElementWidth(ref: RefObject<HTMLElement | null>, fallback = 560): number {
  const [w, setW] = useState(fallback);
  useIso(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setW(Math.max(200, Math.floor(el.getBoundingClientRect().width)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** Bumps whenever the colour scheme may have changed (OS setting or a theme attribute/class). */
export function useThemeVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const bump = () => setV((x) => x + 1);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", bump);
    const mo = new MutationObserver(bump);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
    // first paint after mount: CSS variables are now resolvable
    bump();
    return () => {
      mq.removeEventListener("change", bump);
      mo.disconnect();
    };
  }, []);
  return v;
}

/** Device pixel ratio aware canvas sizing. Returns the 2D context scaled to CSS pixels. */
export function prepareCanvas(canvas: HTMLCanvasElement | null, width: number, height: number): CanvasRenderingContext2D | null {
  if (!canvas) return null;
  const dpr = Math.min(3, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
  const W = Math.round(width * dpr);
  const H = Math.round(height * dpr);
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return ctx;
}
