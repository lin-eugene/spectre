import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Spectre · Ubiquitin",
  description:
    "Spectre — protein NMR backbone assignment from multidimensional spectra, with the 3D structure and an AI assistant.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

// Light is the default. Before first paint (no flash) apply a saved choice: "dark", or "system"
// to follow the OS (attribute removed so prefers-color-scheme decides).
const themeScript = `(function(){try{var t=localStorage.getItem("spectre:theme"),e=document.documentElement;if(t==="system")e.removeAttribute("data-theme");else e.setAttribute("data-theme",t==="dark"?"dark":"light")}catch(x){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning className={`${plexSans.variable} ${plexMono.variable} antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
