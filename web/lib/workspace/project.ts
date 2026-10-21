/** The user's Java project: files, open tabs, and settings. Pure functions, persisted locally. */

export type ProjectFile = { path: string; content: string; saved: string };
export type Project = {
  files: ProjectFile[];
  /** Folders the user created, kept even while empty. Folders holding files also come from paths. */
  folders: string[];
  open: string[];
  active: string | null;
  mainClass: string | null;
  /** Older projects' single shared input; kept only so their saved data still loads. Not used for running. */
  stdin: string;
  /** Each program file's own given input, by path: what Visualize and "Run with this input" feed it. */
  inputs: Record<string, string>;
  fontSize: number;
};

export const STORAGE_KEY = "codeviz.project.v1";
/** Matches the runner's default RUNNER_MAX_FILES. */
export const MAX_FILES = 64;

/* A new project starts with an empty program, ready to write. */
const SAMPLE = `public class Main {
    public static void main(String[] args) {

    }
}
`;
/* The bubble sort sample earlier versions started with; an untouched copy of it is cleared on load. */
const OLD_SAMPLE = `public class Main {
    public static void main(String[] args) {
        int[] arr = {5, 1, 4, 2, 8};
        for (int i = 0; i < arr.length - 1; i++) {
            for (int j = 0; j < arr.length - 1 - i; j++) {
                if (arr[j] > arr[j + 1]) {
                    int tmp = arr[j];
                    arr[j] = arr[j + 1];
                    arr[j + 1] = tmp;
                }
            }
        }
        System.out.println(java.util.Arrays.toString(arr));
    }
}
`;

export function defaultProject(): Project {
  return {
    files: [{ path: "Main.java", content: SAMPLE, saved: SAMPLE }],
    folders: [],
    open: ["Main.java"],
    active: "Main.java",
    mainClass: null,
    stdin: "",
    inputs: {},
    fontSize: 14,
  };
}

const SEGMENT = /^[A-Za-z_$][\w$-]*$/;

/** Returns an error message, or null if the path is valid for a new or renamed file. */
export function validatePath(path: string, existing: string[], ignore?: string): string | null {
  const p = path.trim();
  if (!p) return "Enter a file name.";
  const isPy = p.endsWith(".py");
  const isData = DATA_FILE.test(p);
  const isNative = NATIVE_FILE.test(p);
  if (!p.endsWith(".java") && !isPy && !isData && !isNative) return "Files must end in .java, .py, .c, .h, .cpp, .hpp, or a data type like .csv, .json, or .txt.";
  if (p.startsWith("/") || p.includes("..") || p.includes("\\")) return "Use a relative path like com/example/App.java.";
  const parts = p.split("/");
  const name = parts.pop() as string;
  if (!parts.every((s) => SEGMENT.test(s))) return "Folder names can use letters, digits, _ and $.";
  if (isNative && !/^[A-Za-z_][\w-]*\.(c|h|cpp|cc|cxx|hpp|hh|hxx)$/.test(name)) return "C and C++ file names can use letters, digits, _ and -, like list.c or shapes.hpp.";
  if (isData && !/^[\w][\w.-]*$/.test(name)) return "Data file names can use letters, digits, _, - and dots.";
  if (isPy && !/^[A-Za-z_][A-Za-z0-9_]*\.py$/.test(name)) return "Python file names must be valid module names, like main.py.";
  if (!isPy && !isData && !isNative && !/^[A-Za-z_$][\w$]*\.java$/.test(name)) return "File names must be valid Java identifiers, like App.java.";
  if (existing.some((e) => e === p && e !== ignore)) return "A file with that path already exists.";
  return null;
}

export const packageOf = (code: string) =>
  stripComments(code).match(/^\s*package\s+([\w.]+)\s*;/m)?.[1] ?? null;
export const publicClassOf = (code: string) =>
  stripComments(code).match(/^\s*public\s+(?:final\s+|abstract\s+|sealed\s+)*(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/m)?.[1] ?? null;
const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

/** Gentle warnings that never block editing; javac reports the authoritative errors. */
/** C and C++ sources and headers. */
export const NATIVE_FILE = /\.(c|h|cpp|cc|cxx|hpp|hh|hxx)$/;

/** Data files programs can read (and Python programs write): plain text, kept with the project. */
export const DATA_FILE = /\.(txt|csv|tsv|json|md|xml|ya?ml|toml|ini|cfg)$/;

export function fileWarnings(file: ProjectFile): string[] {
  if (!file.path.endsWith(".java")) return [];
  const warnings: string[] = [];
  const name = file.path.split("/").pop()!.replace(/\.java$/, "");
  const pub = publicClassOf(file.content);
  if (pub && pub !== name) warnings.push(`The public class ${pub} should be in a file named ${pub}.java.`);
  const pkg = packageOf(file.content);
  const dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")).replace(/^src\/(main\/java\/)?/, "") : "";
  if (pkg && dir && pkg.replace(/\./g, "/") !== dir) warnings.push(`Package ${pkg} usually lives in the folder ${pkg.replace(/\./g, "/")}/.`);
  return warnings;
}

export function newClassSource(path: string): string {
  if (DATA_FILE.test(path)) return "";
  if (/\.c$/.test(path)) return `#include <stdio.h>\n\nint main(void) {\n    printf("Hello from C\\n");\n    return 0;\n}\n`;
  if (/\.(cpp|cc|cxx)$/.test(path)) return `#include <iostream>\n\nint main() {\n    std::cout << "Hello from C++\\n";\n    return 0;\n}\n`;
  if (/\.(h|hpp|hh|hxx)$/.test(path)) {
    const guard = path.split("/").pop()!.replace(/[^A-Za-z0-9]/g, "_").toUpperCase();
    return `#ifndef ${guard}\n#define ${guard}\n\n#endif\n`;
  }
  if (path.endsWith(".py")) return `def main():\n    pass\n\n\nif __name__ == "__main__":\n    main()\n`;
  const name = path.split("/").pop()!.replace(/\.java$/, "");
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")).replace(/^src\/(main\/java\/)?/, "") : "";
  const pkg = dir ? `package ${dir.replace(/\//g, ".")};\n\n` : "";
  return `${pkg}public class ${name} {\n\n}\n`;
}

export const isDirty = (f: ProjectFile) => f.content !== f.saved;

/**
 * Adds a new file and opens it. A file already at that path is kept untouched; callers check first.
 * Its starting text counts as saved, so the file is stored (and survives a refresh) right away.
 */
export function addFile(p: Project, path: string, content: string): Project {
  if (p.files.length >= MAX_FILES || p.files.some((f) => f.path === path)) return p;
  const files = [...p.files, { path, content, saved: content }].sort((a, b) => a.path.localeCompare(b.path));
  return { ...p, files, open: p.open.includes(path) ? p.open : [...p.open, path], active: path };
}

/** How an incoming file relates to the workspace: new, identical to what is there, or different. */
export type Incoming = { path: string; content: string; status: "new" | "same" | "conflict" };

export function planAdd(p: Project, files: { path: string; content: string }[]): Incoming[] {
  return files.map((f) => {
    const existing = p.files.find((x) => x.path === f.path);
    return { ...f, status: !existing ? "new" : existing.content === f.content ? "same" : "conflict" };
  });
}

/**
 * Adds files without disturbing anything else: new paths are added, identical files are left as
 * they are, and a different file at the same path is replaced only when listed in `replace`.
 * Added files count as saved when `saved` is set (pristine example sources), so they persist.
 * Returns null when the project would go over the file limit.
 */
export function addFiles(p: Project, files: { path: string; content: string }[], opts: { replace?: Set<string>; saved?: boolean } = {}): Project | null {
  const plan = planAdd(p, files);
  const fresh = plan.filter((f) => f.status === "new");
  if (p.files.length + fresh.length > MAX_FILES) return null;
  const replace = opts.replace ?? new Set<string>();
  const updated = p.files.map((f) => {
    const hit = plan.find((x) => x.path === f.path && x.status === "conflict" && replace.has(x.path));
    return hit ? { ...f, content: hit.content, saved: opts.saved ? hit.content : f.saved } : f;
  });
  const added = fresh.map((f) => ({ path: f.path, content: f.content, saved: opts.saved ? f.content : "" }));
  return { ...p, files: [...updated, ...added].sort((a, b) => a.path.localeCompare(b.path)) };
}

/* ---------------- Folders ---------------- */

const under = (path: string, folder: string) => path === folder || path.startsWith(folder + "/");

/** Every folder in the project: created ones and the parents of every file. */
export function allFolders(p: Pick<Project, "files" | "folders">): string[] {
  const out = new Set(p.folders);
  for (const path of [...p.files.map((f) => f.path), ...p.folders]) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) out.add(parts.slice(0, i).join("/"));
  }
  for (const f of p.files) out.delete(f.path);
  return [...out].sort();
}

export function validateFolder(path: string, p: Pick<Project, "files" | "folders">, ignore?: string): string | null {
  const v = path.trim().replace(/\/+$/, "");
  if (!v) return "Enter a folder name.";
  if (v.startsWith("/") || v.includes("..") || v.includes("\\")) return "Use a relative path like animals or com/example.";
  if (!v.split("/").every((s) => SEGMENT.test(s))) return "Folder names can use letters, digits, _ and $.";
  if (v.endsWith(".java")) return "That looks like a file name. Folders have no extension.";
  if (allFolders(p).some((f) => f === v && f !== ignore)) return "A folder with that path already exists.";
  if (p.files.some((f) => f.path === v)) return "A file already has that path.";
  return null;
}

export function createFolder(p: Project, path: string): Project {
  return { ...p, folders: [...new Set([...p.folders, path.trim().replace(/\/+$/, "")])].sort() };
}

/** Moves a folder and everything in it, keeping each file's content, saved state, and open tab. */
export function renameFolder(p: Project, from: string, to: string): Project {
  const move = (path: string) => (under(path, from) ? to + path.slice(from.length) : path);
  return {
    ...p,
    files: p.files.map((f) => ({ ...f, path: move(f.path) })).sort((a, b) => a.path.localeCompare(b.path)),
    folders: [...new Set(p.folders.map(move))].sort(),
    open: p.open.map(move),
    active: p.active ? move(p.active) : null,
    inputs: Object.fromEntries(Object.entries(p.inputs).map(([k, v]) => [move(k), v])),
  };
}

/** Files inside a folder, at any depth. */
export const filesIn = (p: Project, folder: string) => p.files.filter((f) => under(f.path, folder));

export function deleteFolder(p: Project, folder: string): Project {
  const keep = (path: string) => !under(path, folder);
  const files = p.files.filter((f) => keep(f.path));
  const open = p.open.filter(keep);
  const moved = p.active && !keep(p.active) ? landing(files, open, p.active) : { open, active: p.active };
  return { ...p, files, folders: p.folders.filter(keep), ...moved, inputs: Object.fromEntries(Object.entries(p.inputs).filter(([k]) => keep(k))) };
}

/** The folder a path lives in, or "" at the top level. */
const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
/** Moving or deleting the last file in a folder keeps the folder, so it does not vanish from the tree. */
const keepParent = (folders: string[], path: string) => (parentOf(path) && !folders.includes(parentOf(path)) ? [...folders, parentOf(path)].sort() : folders);

export function renameFile(p: Project, from: string, to: string): Project {
  return {
    ...p,
    folders: keepParent(p.folders, from),
    files: p.files.map((f) => (f.path === from ? { ...f, path: to } : f)).sort((a, b) => a.path.localeCompare(b.path)),
    open: p.open.map((o) => (o === from ? to : o)),
    active: p.active === from ? to : p.active,
    /* A renamed or moved file keeps its given input. */
    inputs: Object.fromEntries(Object.entries(p.inputs).map(([k, v]) => [k === from ? to : k, v])),
  };
}

/**
 * When the open file goes away, the editor moves to another open tab, or else to the file next to
 * it in the explorer, so it never shows nothing while files remain.
 */
function landing(files: ProjectFile[], open: string[], gone: string): { open: string[]; active: string | null } {
  if (open.length) return { open, active: open.at(-1)! };
  const next = files.find((f) => f.path.localeCompare(gone) > 0) ?? files.at(-1);
  return next ? { open: [next.path], active: next.path } : { open: [], active: null };
}

export function deleteFile(p: Project, path: string): Project {
  const files = p.files.filter((f) => f.path !== path);
  const open = p.open.filter((o) => o !== path);
  const moved = p.active === path ? landing(files, open, path) : { open, active: p.active };
  const { [path]: _gone, ...inputs } = p.inputs;
  void _gone;
  return { ...p, files, folders: keepParent(p.folders, path), ...moved, inputs };
}

/**
 * Shows a file in the editor without growing the tab strip: an open file is just selected;
 * otherwise it takes over the current tab, unless that tab has unsaved edits worth keeping in view.
 */
export function showInCurrentTab(p: Project, path: string): Project {
  if (p.open.includes(path)) return { ...p, active: path };
  const current = p.files.find((f) => f.path === p.active);
  if (!p.active || !current || isDirty(current)) return openFile(p, path);
  return { ...p, open: p.open.map((o) => (o === p.active ? path : o)), active: path };
}

export function closeTab(p: Project, path: string): Project {
  const i = p.open.indexOf(path);
  const open = p.open.filter((o) => o !== path);
  return { ...p, open, active: p.active === path ? open[Math.max(0, i - 1)] ?? null : p.active };
}

export function openFile(p: Project, path: string): Project {
  return { ...p, open: p.open.includes(path) ? p.open : [...p.open, path], active: path };
}

export function setContent(p: Project, path: string, content: string): Project {
  return { ...p, files: p.files.map((f) => (f.path === path ? { ...f, content } : f)) };
}

export function markSaved(p: Project, path?: string): Project {
  return { ...p, files: p.files.map((f) => (!path || f.path === path ? { ...f, saved: f.content } : f)) };
}

/** Saved state only: unsaved edits live in memory, and leaving the page warns about them. */
export function serialize(p: Project): string {
  return JSON.stringify({
    v: 1,
    files: p.files.filter((f) => f.saved !== "" || f.content === "").map((f) => ({ path: f.path, content: f.saved })),
    folders: p.folders,
    open: p.open,
    active: p.active,
    mainClass: p.mainClass,
    stdin: p.stdin,
    inputs: p.inputs,
    fontSize: p.fontSize,
  });
}

export function deserialize(text: string | null): Project | null {
  if (!text) return null;
  try {
    const d = JSON.parse(text);
    if (d?.v !== 1 || !Array.isArray(d.files) || d.files.length === 0) return null;
    const files: ProjectFile[] = d.files
      .filter((f: unknown): f is { path: string; content: string } => !!f && typeof (f as { path: unknown }).path === "string" && typeof (f as { content: unknown }).content === "string")
      .filter((f: { path: string }) => validatePath(f.path, []) === null)
      .map((f: { path: string; content: string }) => ({ path: f.path, content: f.content, saved: f.content }))
      /* Main.java still exactly as the old bubble sort sample: never edited, so it becomes the empty program. */
      .map((f: ProjectFile) => (f.path === "Main.java" && f.content === OLD_SAMPLE ? { ...f, content: SAMPLE, saved: SAMPLE } : f));
    if (files.length === 0) return null;
    const paths = new Set(files.map((f) => f.path));
    const open = (Array.isArray(d.open) ? d.open : []).filter((o: unknown) => typeof o === "string" && paths.has(o));
    const folders = (Array.isArray(d.folders) ? d.folders : []).filter((f: unknown): f is string => typeof f === "string" && validateFolder(f, { files: [], folders: [] }) === null);
    return {
      files,
      folders,
      open: open.length ? open : [files[0].path],
      active: paths.has(d.active) ? d.active : (open[0] ?? files[0].path),
      mainClass: typeof d.mainClass === "string" ? d.mainClass : null,
      stdin: typeof d.stdin === "string" ? d.stdin : "",
      /* Only inputs for files that still exist. */
      inputs: d.inputs && typeof d.inputs === "object" ? Object.fromEntries(Object.entries(d.inputs as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string" && paths.has(e[0]))) : {},
      fontSize: typeof d.fontSize === "number" ? Math.min(22, Math.max(11, d.fontSize)) : 14,
    };
  } catch {
    return null;
  }
}

export type TreeNode = { name: string; path: string; children: TreeNode[]; file: boolean };

export function fileTree(files: ProjectFile[], folders: string[] = []): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: [], file: false };
  const entries = [...folders.map((path) => ({ path, folder: true })), ...files.map((f) => ({ path: f.path, folder: false }))];
  for (const f of entries) {
    const parts = f.path.split("/");
    let node = root;
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join("/");
      let child = node.children.find((c) => c.name === part);
      if (!child) {
        child = { name: part, path, children: [], file: !f.folder && i === parts.length - 1 };
        node.children.push(child);
      }
      node = child;
    });
  }
  const sort = (n: TreeNode) => {
    n.children.sort((a, b) => Number(a.file) - Number(b.file) || a.name.localeCompare(b.name));
    n.children.forEach(sort);
  };
  sort(root);
  return root.children;
}
