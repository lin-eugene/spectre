// Component harness page (/dev/bruker) used while building the 1D view in isolation; not part
// of the production app.
import type { ReactNode } from "react";
import { notFound } from "next/navigation";

export default function DevLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === "production") notFound();
  return children;
}
