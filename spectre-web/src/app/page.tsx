// Landing page: the scroll-driven 3D story (fixed canvas behind) and the page content on top.
// The app itself lives at /app.
import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import LandingPage from "@/components/landing/LandingPage";
import StoryCanvas from "@/components/landing/StoryCanvas";
import "@/components/landing/landing.css";
import { getLandingSceneData } from "@/lib/landing/data";

const title = "Spectre — Solving the slowest step in protein NMR";
const description =
  "Free protein NMR assignment in your browser: multidimensional spectra in, confidence-coloured assignments out. Real spectra, a 3D structure and an AI assistant. No install, no account.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: "website", siteName: "Spectre" },
  twitter: { card: "summary", title, description },
};

// the demo data is fixed, but building it stamps project timestamps, so cache the result
async function sceneData() {
  "use cache";
  cacheLife("max");
  return getLandingSceneData();
}

export default async function Home() {
  const data = await sceneData();
  return (
    <>
      <StoryCanvas data={data} />
      <LandingPage />
    </>
  );
}
