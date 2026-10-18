// Downloads dataset files into the local cache: streamed to "<file>.part" then renamed, so an
// interrupted download never leaves a truncated file that looks complete.
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { localPathFor } from "./catalog";

export interface DownloadItem {
  url: string;
  mb: number;
}

export interface DownloadProgress {
  file: string;
  index: number;
  count: number;
  bytes: number; // bytes received so far (all files)
  total: number; // expected total bytes
}

export async function downloadAll(
  items: DownloadItem[],
  opts: { maxMB?: number; onProgress?: (p: DownloadProgress) => void; fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<{ downloaded: string[]; reused: string[]; bytes: number }> {
  const doFetch = opts.fetchImpl ?? fetch;
  const pending = items.filter((it) => !fs.existsSync(localPathFor(it.url)));
  const reused = items.filter((it) => fs.existsSync(localPathFor(it.url))).map((it) => it.url);
  const estimate = pending.reduce((s, it) => s + it.mb * 1024 * 1024, 0);
  const maxBytes = (opts.maxMB ?? 400) * 1024 * 1024;
  if (estimate > maxBytes) throw new Error(`download needs ~${(estimate / 1048576).toFixed(0)} MB, above the ${opts.maxMB ?? 400} MB limit (pass maxMB to allow it)`);
  let bytes = 0;
  const downloaded: string[] = [];
  for (let i = 0; i < pending.length; i++) {
    const it = pending[i];
    const dest = localPathFor(it.url);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const part = `${dest}.part`;
    const res = await doFetch(it.url, { signal: opts.signal });
    if (!res.ok || !res.body) throw new Error(`download failed (${res.status}) for ${it.url}`);
    const len = Number(res.headers.get("content-length")) || it.mb * 1048576;
    const total = estimate - it.mb * 1048576 + len;
    let fileBytes = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        fileBytes += chunk.length;
        bytes += chunk.length;
        if (bytes > maxBytes * 1.2) {
          cb(new Error(`download exceeded the ${opts.maxMB ?? 400} MB limit`));
          return;
        }
        opts.onProgress?.({ file: path.basename(dest), index: i, count: pending.length, bytes, total: Math.max(total, bytes) });
        cb(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), counter, fs.createWriteStream(part));
      fs.renameSync(part, dest);
      downloaded.push(it.url);
    } catch (e) {
      fs.rmSync(part, { force: true });
      throw e;
    }
    void fileBytes;
  }
  return { downloaded, reused, bytes };
}
