/**
 * How an example becomes part of the workspace. Each example lives in its own folder and package
 * (examples/binarysearch/BinarySearchExample.java, package examples.binarysearch), so helper
 * classes such as Node in two examples never collide with each other or with the user's files.
 * A second copy goes in a numbered folder and package, so nothing inside has to be renamed.
 */
import type { Example } from "./catalog";

/** The package segment for an example: BinarySearchExample -> binarysearch. */
export function exampleSlug(ex: Example): string {
  if (ex.dir) return ex.dir.replace(/[^A-Za-z0-9_$]/g, "").toLowerCase();
  return ex.id.replace(/Example$/, "").replace(/[^A-Za-z0-9_$]/g, "").toLowerCase() || "example";
}

/** Adds `package examples.<slug>;` to a single-file example written for the default package. */
function packaged(source: string, pkg: string): string {
  if (/^\s*package\s+[\w.]+\s*;/m.test(source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, ""))) return source;
  return `package ${pkg};\n\n${source}`;
}

export type ExampleFiles = { files: { path: string; content: string }[]; entry: string; mainClass: string; slug: string };

/** The workspace files for an example, fetched from public/examples. copy 1 is the original folder. */
export async function exampleFiles(ex: Example, copy = 1, override?: Record<string, string>): Promise<ExampleFiles> {
  const base = exampleSlug(ex);
  const slug = copy > 1 ? `${base}${copy}` : base;
  const sources = ex.files ?? [ex.file];
  const files = await Promise.all(
    sources.map(async (rel) => {
      const url = ex.dir ? `/examples/${ex.dir}/${rel}` : `/examples/${rel}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`Could not load ${rel}.`);
      let content = override?.[rel] ?? (await res.text());
      /* Multi-file examples are written in examples.<dir>; a copy moves the whole group to examples.<dir>N. */
      content = ex.dir ? content.replace(new RegExp(`\\bexamples\\.${base}\\b`, "g"), `examples.${slug}`) : packaged(content, `examples.${slug}`);
      return { path: `examples/${slug}/${rel}`, content };
    }),
  );
  const entry = `examples/${slug}/${ex.file}`;
  /* Python programs are run by file; Java by class name. */
  const mainClass = ex.file.endsWith(".py") ? entry : `examples.${slug}.${ex.file.replace(/\.java$/, "").replace(/\//g, ".")}`;
  return { files, entry, mainClass, slug };
}

/** The next free copy number whose folder is not in the workspace yet. */
export function nextCopy(ex: Example, folders: string[], paths: string[]): number {
  const base = exampleSlug(ex);
  for (let n = 2; n < 100; n++) {
    const dir = `examples/${base}${n}`;
    if (!folders.includes(dir) && !paths.some((p) => p.startsWith(dir + "/"))) return n;
  }
  return 100;
}
