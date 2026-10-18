"use client";
// React hooks around the real-spectrum endpoints. A new request keeps the previous plane on
// screen (dimmed by the caller) until the new one arrives; results are cached in lib/viz/real.
import { useEffect, useState } from "react";
import { fetchPlane, fetchStrip, planeUrl, type PlaneQuery, type RealPlane, type RealStrip } from "@/lib/viz/real";

export function useRealPlane(projectId: string | undefined, name: string | null | undefined, q: PlaneQuery | null) {
  const key = projectId && name && q ? planeUrl(projectId, name, q) : null;
  const [state, setState] = useState<{ key: string | null; plane: RealPlane | null; error: string | null }>({ key: null, plane: null, error: null });
  useEffect(() => {
    if (!key || !projectId || !name || !q) return;
    let alive = true;
    fetchPlane(projectId, name, q)
      .then((plane) => alive && setState({ key, plane, error: null }))
      .catch((e: unknown) => alive && setState((s) => ({ key, plane: s.plane, error: e instanceof Error ? e.message : String(e) })));
    return () => {
      alive = false;
    };
    // key captures every query field
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return {
    plane: key ? state.plane : null,
    loading: !!key && state.key !== key,
    error: key && state.key === key ? state.error : null,
    stale: !!key && state.key !== key && !!state.plane,
  };
}

export interface StripRequest {
  key: string;
  name: string;
  h: number;
  n: number;
  hw: number;
}

/** Fetches real strips (cached per spectrum/root position); returns those resolved so far. */
export function useRealStrips(projectId: string | undefined, reqs: StripRequest[]) {
  const [done, setDone] = useState<Map<string, RealStrip>>(() => new Map());
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const sig = reqs.map((r) => r.key).join("|");
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    for (const r of reqs) {
      fetchStrip(projectId, r.name, r.h, r.n, r.hw)
        .then((s) => {
          if (!alive) return;
          setDone((m) => (m.get(r.key) === s ? m : new Map(m).set(r.key, s)));
        })
        .catch(() => alive && setFailed((f) => (f.has(r.key) ? f : new Set(f).add(r.key))));
    }
    return () => {
      alive = false;
    };
    // sig captures every request
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, sig]);
  return { strips: done, failed };
}
