// Where projects made from your own data keep their files: <data dir>/uploads/<project id>/ holds
// the uploaded spectra and peak lists. Spectra and peak lists can also be used in place from the
// ARTINA download cache (<data dir>/artina/), referenced by a stored data path.
import path from "node:path";
import { cacheRoot } from "../artina/catalog";

export function uploadsRoot(): string {
  return process.env.SPECTRE_DATA_DIR ? path.join(process.env.SPECTRE_DATA_DIR, "uploads") : path.join(process.cwd(), ".data", "uploads");
}

export function uploadDir(projectId: string): string {
  return path.join(uploadsRoot(), projectId);
}

/** stored data paths of uploads start with this; any other stored path is inside the ARTINA cache */
export const UPLOAD_PREFIX = "uploads/";

/**
 * Resolve a stored data path safely: "uploads/<project>/<file>" inside the uploads directory,
 * anything else (e.g. "2K50/spectra/HNCA.pipe") inside the ARTINA cache. null when the path
 * would leave its directory.
 */
export function resolveStored(rel: string): string | null {
  const upload = rel.startsWith(UPLOAD_PREFIX);
  const root = path.resolve(upload ? uploadsRoot() : cacheRoot());
  const abs = path.resolve(root, upload ? rel.slice(UPLOAD_PREFIX.length) : rel);
  if (!abs.startsWith(root + path.sep)) return null;
  return abs;
}

/** The stored data path of a file in the ARTINA cache (inverse of resolveStored). */
export function storedPathInCache(abs: string): string {
  return path.relative(cacheRoot(), abs).split(path.sep).join("/");
}

/** Absolute path of a project file (spectrum or peak list): the stored file used in place, else the file in its upload directory. */
export function spectrumPath(projectId: string, s: { file: string; stored?: string }): string | null {
  return s.stored ? resolveStored(s.stored) : path.join(uploadDir(projectId), s.file);
}
