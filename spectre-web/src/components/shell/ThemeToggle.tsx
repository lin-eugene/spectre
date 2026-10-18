"use client";
// Three-way theme switch (system / light / dark) persisted in localStorage; light is the default.
// The inline script in layout.tsx applies the saved choice before first paint.
import { useEffect, useState } from "react";
import { IconMonitor, IconMoon, IconSun } from "@/components/ui/Icons";
import { cx } from "@/components/ui/primitives";

type Theme = "system" | "light" | "dark";
const KEY = "spectre:theme";

function readTheme(): Theme {
  try {
    const t = window.localStorage.getItem(KEY);
    return t === "dark" || t === "system" ? t : "light";
  } catch {
    return "light";
  }
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // sync with the value the inline script already applied
    const t = readTheme();
    const id = window.requestAnimationFrame(() => {
      setTheme(t);
      setMounted(true);
    });
    return () => window.cancelAnimationFrame(id);
  }, []);

  const apply = (t: Theme) => {
    setTheme(t);
    try {
      if (t === "light") window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, t);
    } catch {
      /* ignore */
    }
    if (t === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
  };

  const opts: { t: Theme; label: string; icon: React.ReactNode }[] = [
    { t: "system", label: "System theme", icon: <IconMonitor size={14} /> },
    { t: "light", label: "Light theme", icon: <IconSun size={14} /> },
    { t: "dark", label: "Dark theme", icon: <IconMoon size={14} /> },
  ];
  return (
    <div role="radiogroup" aria-label="Colour theme" className="flex items-center rounded-full border border-line bg-surface-2 p-0.5">
      {opts.map((o) => (
        <button
          key={o.t}
          type="button"
          role="radio"
          aria-checked={mounted && theme === o.t}
          aria-label={o.label}
          title={o.label}
          onClick={() => apply(o.t)}
          className={cx(
            "grid h-6 w-7 place-items-center rounded-full text-muted transition-colors hover:text-fg",
            mounted && theme === o.t && "bg-surface text-fg shadow-[var(--shadow)]",
          )}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}
