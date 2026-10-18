"use client";
// Fades its children in the first time they scroll into view (see .lp-reveal in landing.css;
// reduced motion and no-JS both show the content straight away).
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

export default function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      el.dataset.in = "true";
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        el.dataset.in = "true";
        io.disconnect();
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={className ? `lp-reveal ${className}` : "lp-reveal"} style={{ "--d": `${delay}ms` } as CSSProperties}>
      {children}
    </div>
  );
}
