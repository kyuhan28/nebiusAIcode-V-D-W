/**
 * Adding an example to the workspace, as pure steps the workspace and its tests share. An example
 * is added next to everything already there; it never replaces the project.
 */
import type { ExampleFiles } from "@/lib/examples/load";
import { addFiles, planAdd, showInCurrentTab, type Project } from "./project";

/** same: already there, unchanged. new: none of it is there yet. conflict: the user edited it. */
export type ExamplePlan = { kind: "same" | "new" | "conflict"; changed: string[]; fresh: number };

export function planExample(p: Project, built: ExampleFiles): ExamplePlan {
  const plan = planAdd(p, built.files);
  const changed = plan.filter((f) => f.status === "conflict").map((f) => f.path);
  const fresh = plan.filter((f) => f.status === "new").length;
  /* Some files present and unchanged, some missing (deleted earlier): adding the missing ones is safe. */
  const kind = changed.length ? "conflict" : fresh === 0 ? "same" : "new";
  return { kind, changed, fresh };
}

/**
 * The project with the example's files added (and `replace` paths overwritten, only when the user
 * chose that), its entry file showing in the current editor tab, and its sample input filled in
 * when the Input tab is empty. Null when it would go over the file limit; nothing changes then.
 */
export function withExample(p: Project, built: ExampleFiles, stdin: string | undefined, replace: Set<string> = new Set()): { project: Project; keptInput: boolean } | null {
  const next = addFiles(p, built.files, { replace, saved: true });
  if (!next) return null;
  const keptInput = !!stdin && !!p.stdin.trim() && p.stdin !== stdin;
  const withInput = stdin && !p.stdin.trim() ? { ...next, stdin } : next;
  return { project: showInCurrentTab(withInput, built.entry), keptInput };
}
