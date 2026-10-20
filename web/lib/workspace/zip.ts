/**
 * Reads .java files from uploads and .zip archives entirely in the browser, using the
 * platform's DecompressionStream, so no archive library is needed. Uploaded content is
 * treated as untrusted: paths are validated, sizes are capped, and nothing is extracted to disk.
 */
import { validatePath } from "./project";

export type ImportedFile = { path: string; content: string };
export type Skipped = { path: string; reason: string };
export type ImportPreview = { files: ImportedFile[]; skipped: Skipped[] };

const MAX_ENTRIES = 500;
const MAX_FILE = 256 * 1024;
const MAX_TOTAL = 2 * 1024 * 1024;

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Lists a ZIP's entries from its central directory and returns the .java files. */
export async function readZip(buffer: ArrayBuffer): Promise<{ entries: { path: string; data: Uint8Array | null; reason?: string }[] }> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("This file is not a valid ZIP archive.");
  const count = view.getUint16(eocd + 10, true);
  if (count > MAX_ENTRIES) throw new Error(`The archive has ${count} entries; the limit is ${MAX_ENTRIES}.`);
  let ptr = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries: { path: string; data: Uint8Array | null; reason?: string }[] = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) throw new Error("The archive's directory is damaged.");
    const flags = view.getUint16(ptr + 8, true);
    const method = view.getUint16(ptr + 10, true);
    const compressed = view.getUint32(ptr + 20, true);
    const size = view.getUint32(ptr + 24, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const local = view.getUint32(ptr + 42, true);
    const path = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;
    if (path.endsWith("/")) continue;
    if (!path.endsWith(".java")) { entries.push({ path, data: null, reason: "Not a .java file" }); continue; }
    if (flags & 1) { entries.push({ path, data: null, reason: "Encrypted entries are not supported" }); continue; }
    if (size > MAX_FILE) { entries.push({ path, data: null, reason: "Larger than 256 KB" }); continue; }
    total += size;
    if (total > MAX_TOTAL) throw new Error("The archive's Java sources exceed 2 MB in total.");
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + compressed);
    if (method === 0) entries.push({ path, data: raw });
    else if (method === 8) {
      const out = await inflate(raw);
      if (out.length !== size) throw new Error(`The entry ${path} did not decompress cleanly.`);
      entries.push({ path, data: out });
    } else entries.push({ path, data: null, reason: "Uses an unsupported compression method" });
  }
  return { entries };
}

/** Drops a shared top folder and Maven/Gradle's src/main/java prefix, keeping package folders. */
function normalizePaths(paths: string[]): (p: string) => string {
  const conventional = paths.some((p) => p.includes("src/main/java/"));
  if (conventional) return (p) => p.slice(p.indexOf("src/main/java/") + "src/main/java/".length);
  const tops = new Set(paths.map((p) => (p.includes("/") ? p.split("/")[0] : "")));
  if (tops.size === 1 && !tops.has("")) {
    const top = [...tops][0] + "/";
    return (p) => p.slice(top.length);
  }
  return (p) => p;
}

export async function previewImport(uploads: { name: string; data: ArrayBuffer }[], existing: string[]): Promise<ImportPreview> {
  const raw: { path: string; data: Uint8Array | null; reason?: string }[] = [];
  const skipped: Skipped[] = [];
  for (const u of uploads) {
    if (u.name.toLowerCase().endsWith(".zip")) {
      try {
        raw.push(...(await readZip(u.data)).entries);
      } catch (e) {
        skipped.push({ path: u.name, reason: (e as Error).message });
      }
    } else if (u.name.endsWith(".java")) {
      if (u.data.byteLength > MAX_FILE) skipped.push({ path: u.name, reason: "Larger than 256 KB" });
      else raw.push({ path: u.name, data: new Uint8Array(u.data) });
    } else skipped.push({ path: u.name, reason: "Only .java files and .zip archives can be imported" });
  }
  const javaPaths = raw.filter((r) => r.data).map((r) => r.path.replace(/\\/g, "/"));
  const fix = normalizePaths(javaPaths);
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const seen = new Set<string>();
  const files: ImportedFile[] = [];
  for (const r of raw) {
    const original = r.path.replace(/\\/g, "/");
    if (!r.data) { skipped.push({ path: original, reason: r.reason ?? "Skipped" }); continue; }
    const path = fix(original);
    const problem = validatePath(path, []);
    if (problem || original.split("/").includes("..") || original.startsWith("/")) { skipped.push({ path: original, reason: problem ?? "Unsafe path" }); continue; }
    if (seen.has(path)) { skipped.push({ path: original, reason: "Duplicate path in the upload" }); continue; }
    seen.add(path);
    files.push({ path, content: decoder.decode(r.data) });
  }
  void existing;
  return { files, skipped };
}
