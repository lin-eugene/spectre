// Stroke icons for the landing page (24px grid, currentColor).
import type { ReactNode, SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & { size?: number };

function Svg({ size = 20, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12.5l4.2 4.2L19 7" />
  </Svg>
);

export const IconArrowRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);

export const IconPlay = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M10.2 8.6v6.8l5.4-3.4z" fill="currentColor" />
  </Svg>
);

export const IconLayout = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="M3 9h18M9.5 9v11" />
  </Svg>
);

export const IconCube = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 2.8l8 4.6v9.2l-8 4.6-8-4.6V7.4z" />
    <path d="M4 7.4l8 4.6 8-4.6M12 12v9.2" />
  </Svg>
);

export const IconAtom = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    <ellipse cx="12" cy="12" rx="9.5" ry="3.8" />
    <ellipse cx="12" cy="12" rx="9.5" ry="3.8" transform="rotate(60 12 12)" />
    <ellipse cx="12" cy="12" rx="9.5" ry="3.8" transform="rotate(120 12 12)" />
  </Svg>
);

export const IconChat = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 11.5a7.5 7.5 0 0 1-11.2 6.5L4 19.5l1.6-4.4A7.5 7.5 0 1 1 20 11.5z" />
    <path d="M8.6 11.5h.01M12 11.5h.01M15.4 11.5h.01" strokeWidth={2.6} />
  </Svg>
);

export const IconWave = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 13h2.6l1.5-4.5 2.3 10L11.2 4l2.3 13 1.9-8 1.6 4h4.5" />
  </Svg>
);

export const IconDownload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5" />
    <path d="M4.5 16.5v2a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2" />
  </Svg>
);

export const IconFlask = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.5 3h5M10 3v6.2L4.8 18.3A1.8 1.8 0 0 0 6.4 21h11.2a1.8 1.8 0 0 0 1.6-2.7L14 9.2V3" />
    <path d="M7.2 15h9.6" />
  </Svg>
);

export const IconCap = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 9.2L12 4.8l9.5 4.4L12 13.6z" />
    <path d="M6.5 11.3v4.4c1.6 1.5 3.4 2.2 5.5 2.2s3.9-.7 5.5-2.2v-4.4M21.5 9.2v5" />
  </Svg>
);

export const IconPill = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.8" y="8.2" width="18.4" height="7.6" rx="3.8" transform="rotate(-35 12 12)" />
    <path d="M9.8 8.9l4.4 6.2" />
  </Svg>
);

export const IconMolecule = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7" cy="7" r="2.6" />
    <circle cx="17" cy="8.5" r="2.6" />
    <circle cx="10" cy="17.5" r="2.6" />
    <path d="M9.6 7.4l4.8.7M7.7 9.5l1.6 5.5M15.4 10.6l-3.7 5" />
  </Svg>
);

export const IconCode = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5M13.5 4.5l-3 15" />
  </Svg>
);
