/** The user's Java project: files, open tabs, and settings. Pure functions, persisted locally. */

export type ProjectFile = { path: string; content: string; saved: string };
export type Project = {
  files: ProjectFile[];
  open: string[];
  active: string | null;
  mainClass: string | null;
  stdin: string;
  fontSize: number;
};

export const STORAGE_KEY = "codeviz.project.v1";
const MAX_FILES = 64;

const SAMPLE = `public class Main {
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
    open: ["Main.java"],
    active: "Main.java",
    mainClass: null,
    stdin: "",
    fontSize: 14,
  };
}

const SEGMENT = /^[A-Za-z_$][\w$-]*$/;

/** Returns an error message, or null if the path is valid for a new or renamed file. */
export function validatePath(path: string, existing: string[], ignore?: string): string | null {
  const p = path.trim();
  if (!p) return "Enter a file name.";
  if (!p.endsWith(".java")) return "Java files must end in .java.";
  if (p.startsWith("/") || p.includes("..") || p.includes("\\")) return "Use a relative path like com/example/App.java.";
  const parts = p.split("/");
  const name = parts.pop() as string;
  if (!parts.every((s) => SEGMENT.test(s))) return "Folder names can use letters, digits, _ and $.";
  if (!/^[A-Za-z_$][\w$]*\.java$/.test(name)) return "File names must be valid Java identifiers, like App.java.";
  if (existing.some((e) => e === p && e !== ignore)) return "A file with that path already exists.";
  return null;
}

export const packageOf = (code: string) =>
  stripComments(code).match(/^\s*package\s+([\w.]+)\s*;/m)?.[1] ?? null;
export const publicClassOf = (code: string) =>
  stripComments(code).match(/^\s*public\s+(?:final\s+|abstract\s+|sealed\s+)*(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/m)?.[1] ?? null;
const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

/** Gentle warnings that never block editing; javac reports the authoritative errors. */
export function fileWarnings(file: ProjectFile): string[] {
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
  const name = path.split("/").pop()!.replace(/\.java$/, "");
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")).replace(/^src\/(main\/java\/)?/, "") : "";
  const pkg = dir ? `package ${dir.replace(/\//g, ".")};\n\n` : "";
  return `${pkg}public class ${name} {\n\n}\n`;
}

export const isDirty = (f: ProjectFile) => f.content !== f.saved;

export function addFile(p: Project, path: string, content: string): Project {
  if (p.files.length >= MAX_FILES) return p;
  const files = [...p.files.filter((f) => f.path !== path), { path, content, saved: "" }].sort((a, b) => a.path.localeCompare(b.path));
  return { ...p, files, open: p.open.includes(path) ? p.open : [...p.open, path], active: path };
}

export function renameFile(p: Project, from: string, to: string): Project {
  return {
    ...p,
    files: p.files.map((f) => (f.path === from ? { ...f, path: to } : f)).sort((a, b) => a.path.localeCompare(b.path)),
    open: p.open.map((o) => (o === from ? to : o)),
    active: p.active === from ? to : p.active,
  };
}

export function deleteFile(p: Project, path: string): Project {
  const open = p.open.filter((o) => o !== path);
  return { ...p, files: p.files.filter((f) => f.path !== path), open, active: p.active === path ? open.at(-1) ?? null : p.active };
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
    open: p.open,
    active: p.active,
    mainClass: p.mainClass,
    stdin: p.stdin,
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
      .map((f: { path: string; content: string }) => ({ path: f.path, content: f.content, saved: f.content }));
    if (files.length === 0) return null;
    const paths = new Set(files.map((f) => f.path));
    const open = (Array.isArray(d.open) ? d.open : []).filter((o: unknown) => typeof o === "string" && paths.has(o));
    return {
      files,
      open: open.length ? open : [files[0].path],
      active: paths.has(d.active) ? d.active : (open[0] ?? files[0].path),
      mainClass: typeof d.mainClass === "string" ? d.mainClass : null,
      stdin: typeof d.stdin === "string" ? d.stdin : "",
      fontSize: typeof d.fontSize === "number" ? Math.min(22, Math.max(11, d.fontSize)) : 14,
    };
  } catch {
    return null;
  }
}

export type TreeNode = { name: string; path: string; children: TreeNode[]; file: boolean };

export function fileTree(files: ProjectFile[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: [], file: false };
  for (const f of files) {
    const parts = f.path.split("/");
    let node = root;
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join("/");
      let child = node.children.find((c) => c.name === part);
      if (!child) {
        child = { name: part, path, children: [], file: i === parts.length - 1 };
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
