"use client";
// Fixed, frosted top bar of the landing page; gains a hairline and shadow once the page scrolls.
import Image from "next/image";
import { useSyncExternalStore } from "react";
import { IconArrowRight } from "./icons";

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#who", label: "Who it's for" },
];

function subscribe(onChange: () => void) {
  window.addEventListener("scroll", onChange, { passive: true });
  return () => window.removeEventListener("scroll", onChange);
}

export default function LandingNav() {
  const scrolled = useSyncExternalStore(
    subscribe,
    () => window.scrollY > 8,
    () => false,
  );

  return (
    <header className="lp-nav" data-scrolled={scrolled}>
      <nav className="lp-wrap lp-nav-inner" aria-label="Main">
        <a href="#top" className="lp-brand">
          <Image src="/logo.png" alt="" width={36} height={32} loading="eager" style={{ width: 36, height: 32 }} />
          <span>Spectre</span>
        </a>
        <div className="lp-nav-links">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href}>
              {l.label}
            </a>
          ))}
        </div>
        <span className="lp-nav-spacer" />
        <span className="lp-nav-free">Free</span>
        <a className="lp-btn lp-btn-primary lp-btn-sm" href="/app#top">
          Open app
          <IconArrowRight size={16} />
        </a>
      </nav>
    </header>
  );
}
