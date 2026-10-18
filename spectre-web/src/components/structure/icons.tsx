// Small stroke icons for the viewer toolbar (24x24 grid, currentColor).
import type { SVGProps } from "react";

const base = (props: SVGProps<SVGSVGElement>) => ({
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...props,
});

export const IconReset = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v5h5" />
  </svg>
);

export const IconSpin = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <ellipse cx="12" cy="12" rx="9" ry="4" />
    <path d="M12 3v1.5M12 19.5V21" />
    <path d="M18.5 9.2 21 8l-.6 2.9" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
  </svg>
);

export const IconPause = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <rect x="7" y="5" width="3.2" height="14" rx="1" />
    <rect x="13.8" y="5" width="3.2" height="14" rx="1" />
  </svg>
);

export const IconExpand = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </svg>
);

export const IconCollapse = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
  </svg>
);

export const IconLayers = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="m12 3 9 5-9 5-9-5 9-5Z" />
    <path d="m3 13 9 5 9-5" />
  </svg>
);

export const IconPalette = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-1 2-2 0-1.6-1.3-2.1-1.3-3.2 0-1.1.9-1.8 2-1.8H17a4 4 0 0 0 4-4c0-3.9-4-7-9-7Z" />
    <circle cx="7.5" cy="11" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="10" cy="7" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="15" cy="7" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

export const IconCamera = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);

export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 14, height: 14, ...p })}>
    <path d="m5 12 5 5 9-10" />
  </svg>
);

export const IconClose = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 14, height: 14, ...p })}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const IconModels = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12 3 4.5 7v8.2L12 19.5l7.5-4.3V7L12 3Z" />
    <path d="M4.5 7 12 11.3 19.5 7M12 11.3v8.2" />
  </svg>
);
