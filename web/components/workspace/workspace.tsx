"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CodeEditor, type EditorMarker } from "./code-editor";
import { FileExplorer } from "./file-explorer";
import { ImportDialog } from "./import-dialog";
import { TerminalPanel, PHASE_LABEL, phaseTone, type Phase } from "./terminal-panel";
import { TraceVisualizer } from "./trace-visualizer";
import { StructureVisualizer } from "./structure-visualizer";
import { ScopeOverlay } from "./scope-overlay";
import { InheritanceView } from "./inheritance-view";
import { DpView } from "./dp-view";
import { MemoryView } from "./memory-view";
import type { RawStep } from "@/lib/trace/interpret";
import { buildDp } from "@/lib/trace/dp";
import { describeIssue } from "@/lib/native/memory-issues";
import { normalizeTrace } from "@/lib/trace/scope";
import { firstCalls, type ClassModel } from "@/lib/trace/inheritance";
import { EXAMPLES } from "@/lib/examples/catalog";
import { exampleFiles, exampleSlug, nextCopy, type ExampleFiles } from "@/lib/examples/load";
import { planExample, withExample } from "@/lib/workspace/examples";
import { SpaceScrim } from "./space-scrim";
import { PanelBoundary } from "./panel-boundary";
import { LibraryPanel } from "./library-panel";
import { IoAssistant, type IoRun } from "./io-assistant";
import { NemotronAssistant, type AssistContext, type AssistMode, type CheckResult } from "./nemotron-assistant";
import { languageOfPath, type AiLanguage } from "@/lib/ai/languages";
import { exampleById } from "@/lib/examples/catalog";
import { InputStream } from "./input-stream";
import { replayInput, type InputReplay } from "@/lib/trace/input";
import { BackIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon } from "./icons";
import { interpret, type Interpretation } from "@/lib/trace/interpret";
import {
  MAX_FILES, STORAGE_KEY, addFile, addFiles, closeTab, createFolder, defaultProject, deleteFile, deleteFolder, deserialize, filesIn,
  isDirty, markSaved, newClassSource, openFile, packageOf, planAdd, renameFile, renameFolder, serialize, setContent, showInCurrentTab, validateFolder,
  validatePath, type Project,
} from "@/lib/workspace/project";
import { sendInput,
  RunnerError, cancelExecution, getRuntime, startExecution, waitForExecution, type Diagnostic, type ExecResult, type Runtime,
} from "@/lib/workspace/runner-client";

type Layout = "code" | "split" | "visualize";

/** The class to run for a file: its package (from the source) plus its file name. */
function classFor(path: string, content: string) {
  const base = path.split("/").pop()!.replace(/\.java$/, "");
  const pkg = /^\s*package\s+([\w.]+)\s*;/m.exec(content)?.[1];
  return pkg ? `${pkg}.${base}` : base;
}
/** Earlier versions kept each example as its own saved project under this key. */
const legacyExampleKey = (id: string) => `codeviz.example.${id}.v1`;
/** A dialog with one main action, and optionally a second, gentler one. */
type Confirm = { title: string; body: string; action: string; danger?: boolean; onConfirm: () => void; alt?: { label: string; onClick: () => void } };
const filesKey = (p: Project) => p.files.map((f) => `${f.path}\u0000${f.content}`).join("\u0001");
const SPEEDS = [0.5, 1, 2, 4];
const BUSY: Phase[] = ["preparing", "queued", "compiling", "running"];

/** Classes with a main method, named the way the runner expects (package + file name). */
function entryPoints(project: Project) {
  return project.files
    .filter((f) => /static\s+(?:final\s+)?void\s+main\s*\(\s*(?:final\s+)?String/.test(f.content))
    .map((f) => {
      const pkg = packageOf(f.content);
      const name = f.path.split("/").pop()!.replace(/\.java$/, "");
      return pkg ? `${pkg}.${name}` : name;
    });
}

const btn = "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6fe9ff]/60 disabled:opacity-35";
const iconBtn = "inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-300 transition hover:bg-white/10 hover:text-white";

/** Reads browser storage; null when it is blocked (some privacy modes throw on any access). */
function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function Workspace({ monoFont }: { monoFont: string }) {
  const [project, setProject] = useState<Project>(defaultProject);
  const [hydrated, setHydrated] = useState(false);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<ExecResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [interp, setInterp] = useState<Interpretation | null>(null);
  const [step, setStep] = useState(0);
  /* Recorded Scanner / BufferedReader / StringTokenizer / parse calls, replayed over the real stdin. */
  const [inputReplay, setInputReplay] = useState<InputReplay | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [layout, setLayout] = useState<Layout>("split");
  const [explorer, setExplorer] = useState(true);
  /* On narrow screens the explorer opens over the editor instead of beside it, closed by default. */
  const [mobileFiles, setMobileFiles] = useState(false);
  const toggleFiles = useCallback(() => {
    if (window.matchMedia("(min-width: 768px)").matches) setExplorer((x) => !x);
    else setMobileFiles((x) => !x);
  }, []);
  const [terminalHeight, setTerminalHeight] = useState(220);
  const [rightWidth, setRightWidth] = useState(0.42);
  const [tab, setTab] = useState<"output" | "problems">("output");
  /* The interactive run in the terminal: output so far, whether it reads input, and what was typed. */
  const [live, setLive] = useState<{ id: string; stdout: string; stderr: string; acceptsInput: boolean; echoes: { at: number; text: string }[] } | null>(null);
  const [importing, setImporting] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [resetKey, setResetKey] = useState(0);
  /* The examples library sits under the file explorer in one sidebar, so added files show right above it. */
  const [examplesOpen, setExamplesOpen] = useState(true);
  const examplesRef = useRef<HTMLElement>(null);
  const [rightTab, setRightTab] = useState<"visualize" | "io" | "classes" | "dp" | "memory">("visualize");
  /* Expected Output & Given Inputs: kept here so the code writer can use the same run. */
  const [ioExpected, setIoExpected] = useState("");
  const [ioContext, setIoContext] = useState("");
  const [ioRun, setIoRun] = useState<IoRun | null>(null);
  const [ioRunning, setIoRunning] = useState(false);
  const [assistRequest, setAssistRequest] = useState<{ mode: AssistMode; nonce: number } | null>(null);
  const selection = useRef("");
  const projectRef = useRef(project);
  projectRef.current = project;
  /* javac's class model from the latest clean compile, and the files it was built from. */
  const [classModel, setClassModel] = useState<{ classes: ClassModel[] | null; failed: boolean; key: string }>({ classes: null, failed: false, key: "" });
  const [reveal, setReveal] = useState<{ path: string; line: number; nonce: number } | null>(null);  const job = useRef<{ id: string | null; abort: AbortController } | null>(null);
  const mainRef = useRef<HTMLDivElement>(null);

  /* Load the saved project and ask the runner what it can do. */
  useEffect(() => {
    const saved = deserialize(readStorage(STORAGE_KEY));
    if (saved) setProject(saved);
    setHydrated(true);
  }, []);

  /* Keep checking the runner: it may start after this page, restart, or stop. */
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      clearTimeout(timer);
      getRuntime()
        .then((r) => {
          if (stopped) return;
          setRuntime(r);
          setRuntimeError(null);
          timer = setTimeout(check, 30_000);
        })
        .catch((e: RunnerError) => {
          if (stopped) return;
          setRuntime(null);
          setRuntimeError(e.message);
          timer = setTimeout(check, 5_000);
        });
    };
    const onFocus = () => check();
    check();
    window.addEventListener("focus", onFocus);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  /*
   * Writes the project to browser storage. When storage is full or blocked, the workspace keeps
   * working and says so once, instead of failing in the middle of an update.
   */
  const storageWarned = useRef(false);
  const store = useCallback((text: string): boolean => {
    try {
      localStorage.setItem(STORAGE_KEY, text);
      storageWarned.current = false;
      return true;
    } catch {
      if (!storageWarned.current) {
        storageWarned.current = true;
        queueMicrotask(() => setMessage("Browser storage is full or unavailable, so changes are not being saved and would be lost on reload. Delete large files (big data files especially) to make room."));
      }
      return false;
    }
  }, []);
  /* Saving writes the files; settings such as input and font size are kept without a save. A file is
     only marked saved when the write actually happened. */
  const save = useCallback((p: Project) => {
    const next = markSaved(p);
    return store(serialize(next)) ? next : p;
  }, [store]);
  /* Structural changes (adding, moving, deleting) are stored right away; unsaved edits stay unsaved. */
  const persist = useCallback((p: Project) => {
    store(serialize(p));
    return p;
  }, [store]);
  useEffect(() => {
    if (!hydrated) return;
    const stored = deserialize(readStorage(STORAGE_KEY));
    if (!stored) return;
    store(serialize({ ...stored, mainClass: project.mainClass, stdin: project.stdin, inputs: project.inputs, fontSize: project.fontSize }));
  }, [project.mainClass, project.stdin, project.inputs, project.fontSize, hydrated, store]);

  /*
   * Examples join the workspace: each goes into its own folder and package, next to everything
   * already there. Loading one again opens it; if it was edited, the edits stay unless asked.
   */
  const addExample = useCallback(async (id: string) => {
    const ex = exampleById(id);
    /* Adding never replaces anything, so it is fine while a program runs: that run has its own copy of the files. */
    if (!ex) return;
    const open = (entry: string, note: string) => {
      setProject((p) => (p.files.some((f) => f.path === entry) ? showInCurrentTab(p, entry) : p));
      setMessage(note);
    };
    const apply = (built: ExampleFiles, replace: Set<string>, note: string) => {
      const p = projectRef.current;
      const result = withExample(p, built, ex.stdin, replace);
      if (!result) {
        const fresh = planExample(p, built).fresh;
        setMessage(`Adding ${ex.title} needs ${fresh} more file${fresh === 1 ? "" : "s"}, but projects hold up to ${MAX_FILES}. Delete some files first; nothing was changed.`);
        return;
      }
      setProject(persist(result.project));
      setMessage(note);
    };
    try {
      let built = await exampleFiles(ex);
      const plan = planExample(projectRef.current, built);
      const folder = `examples/${built.slug}/`;
      if (plan.kind === "same") return open(built.entry, `${ex.title} is already in ${folder}, unchanged. Opened it.`);
      if (plan.kind === "new") {
        /* Bring back edits made when this example was a separate project. */
        const first = plan.fresh === built.files.length;
        const legacy = first && !ex.files ? deserialize(readStorage(legacyExampleKey(id)))?.files.find((f) => f.path === ex.file) : undefined;
        const mine = legacy ? await exampleFiles(ex, 1, { [ex.file]: legacy.content }) : null;
        const restored = !!mine && mine.files[0].content !== built.files[0].content;
        if (restored) built = mine!;
        const what = first ? `Added ${ex.title} in ${folder}${restored ? " with the edits you made to it earlier" : ""}` : `Put back the ${plan.fresh} missing file${plan.fresh === 1 ? "" : "s"} of ${ex.title} in ${folder}`;
        return apply(built, new Set(), `${what}. Your other files are unchanged.`);
      }
      const changed = plan.changed;
      setConfirm({
        title: `You have edited ${ex.title}`,
        body: `${changed.length === 1 ? changed[0] : `${changed.length} files in ${folder}`} differ from the original. Your version stays as it is unless you choose to replace it.`,
        action: "Add a fresh copy",
        onConfirm: async () => {
          const n = nextCopy(ex, projectRef.current.folders, projectRef.current.files.map((f) => f.path));
          const copy = await exampleFiles(ex, n);
          apply(copy, new Set(), `Added a fresh copy of ${ex.title} in examples/${copy.slug}/, package examples.${copy.slug}. Your edited version is unchanged.`);
        },
        alt: {
          label: "Replace mine with the original",
          onClick: () =>
            setConfirm({
              title: "Replace your edits?",
              body: `${changed.join(", ")} will go back to the original example. Your changes to ${changed.length === 1 ? "it" : "them"} are lost. Nothing else changes.`,
              action: "Replace",
              danger: true,
              onConfirm: () => apply(built, new Set(changed), `Restored the original ${ex.title}.`),
            }),
        },
      });
    } catch (e) {
      setMessage((e as Error).message);
    }
  }, [persist]);
  const addedExamples = useMemo(
    () => new Set(EXAMPLES.filter((ex) => project.files.some((f) => f.path.startsWith(`examples/${exampleSlug(ex)}/`))).map((ex) => ex.id)),
    [project.files],
  );

  const dirty = project.files.some(isDirty);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const active = project.files.find((f) => f.path === project.active) ?? null;
  const busy = BUSY.includes(phase);
  const mains = useMemo(() => entryPoints(project), [project]);
  /* Run and Visualize use the open file when it has a main method; the dropdown covers the rest. */
  const activeMain = active && /static\s+(?:final\s+)?void\s+main\s*\(\s*(?:final\s+)?String/.test(active.content) ? classFor(active.path, active.content) : null;
  /* An entry point picked in the menu counts only while its class still exists; files get deleted and renamed. */
  const chosenMain = project.mainClass && mains.includes(project.mainClass) ? project.mainClass : null;
  /* A .py file runs itself with the Python runner: every Python file is a program. */
  const activePy = !!active && active.path.endsWith(".py");
  /* C and C++: a source file runs its folder's program; a header builds it (the language comes from its neighbors). */
  const nativeLang = (path: string | null | undefined): "c" | "cpp" | null => {
    if (!path) return null;
    if (/\.c$/.test(path)) return "c";
    if (/\.(cpp|cc|cxx)$/.test(path)) return "cpp";
    if (!/\.(h|hpp|hh|hxx)$/.test(path)) return null;
    const dir = path.slice(0, path.lastIndexOf("/") + 1);
    return /\.(hpp|hh|hxx)$/.test(path) || project.files.some((f) => f.path.startsWith(dir) && /\.(cpp|cc|cxx)$/.test(f.path)) ? "cpp" : "c";
  };
  const activeNative = nativeLang(active?.path);
  const activeNativeSource = !!active && /\.(c|cpp|cc|cxx)$/.test(active.path);
  /* What Run and Visualize use: the open file's main, else a still-valid pick from the menu. Never a deleted file. */
  const runTarget = activePy || activeNativeSource ? active!.path : activeNative ? null : activeMain ?? chosenMain;
  /* Forget a picked entry point as soon as its file is deleted, renamed, or loses its main method. */
  useEffect(() => {
    if (project.mainClass && !mains.includes(project.mainClass)) setProject((p) => ({ ...p, mainClass: null }));
  }, [mains, project.mainClass]);

  /* ---------------- Execution ---------------- */

  /* Each file's own given input. A Java target is a class name: its file holds the input. */
  const inputOf = (target: string | null): string => {
    const path = !target ? active?.path ?? null
      : /\.(py|c|cpp|cc|cxx)$/.test(target) ? target
        : project.files.find((f) => f.path.endsWith(".java") && classFor(f.path, f.content) === target)?.path ?? null;
    return path ? project.inputs[path] ?? "" : "";
  };
  const execute = useCallback(
    async (mode: "compile" | "run" | "trace", override?: { stdin?: string; mainClass?: string | null }): Promise<ExecResult | null> => {
      if (job.current) return null;
      const explicit = !!override && override.mainClass !== undefined;
      const target = explicit ? override!.mainClass! : runTarget;
      /* The language follows the file being run (or, for Compile, the open file). */
      const language: "java" | "python" | "c" | "cpp" = target ? (target.endsWith(".py") ? "python" : nativeLang(target) ?? "java") : activePy ? "python" : activeNative ?? "java";
      /* Nothing in the open file to run (and no entry point picked): compile, so the code is still checked. */
      const effective = mode !== "compile" && !target && !explicit ? "compile" : mode;
      const name = active?.path.split("/").pop() ?? "This file";
      const noMain = effective !== mode
        ? `${name} has no main method, so the project was compiled instead of run. To run a program, open a file with public static void main(String[] args), or pick one in the entry-point menu.`
        : null;
      const abort = new AbortController();
      job.current = { id: null, abort };
      /* Run (from the Run button) is interactive: the program reads what you type into the terminal. */
      const interactive = effective === "run" && !override;
      setLive(null);
      setPhase("preparing");
      setMessage(null);
      setResult(null);
      if (effective === "trace") {
        /* Started from the Given input tab: show the recording (that tab has no playback). */
        setRightTab((t) => (t === "io" ? "visualize" : t));
        /* A new recording starts from the file the user is on. */
        following.current = true;
        autoOpened.current = active?.path ?? null;
        setInterp(null);
      setInputReplay(null);
        setPlaying(false);
      }
      try {
        const files = project.files.map((f) => ({ path: f.path, content: f.content }));
        const started = await startExecution({
          mode: effective,
          files,
          mainClass: target,
          language,
          /* A recording needs its input up front: the given input saved for the file being run, and no other file's. */
          stdin: interactive ? "" : override?.stdin ?? inputOf(target),
          interactive: interactive || undefined,
        });
        job.current.id = started.id;
        setPhase(started.status);
        if (interactive) {
          setTab("output");
          setLive({ id: started.id, stdout: "", stderr: "", acceptsInput: true, echoes: [] });
        }
        const done = await waitForExecution(started.id, (s, ex) => {
          setPhase(s);
          const lv = ex.live;
          if (interactive && lv) setLive((l) => (l && l.id === started.id ? { ...l, stdout: lv.stdout, stderr: lv.stderr, acceptsInput: lv.acceptsInput } : l));
        }, abort.signal);
        if (interactive) setLive((l) => (l && l.id === started.id ? { ...l, acceptsInput: false } : l));
        const r = done.result!;
        setResult(r);
        setPhase(r.status);
        if (r.error) setMessage(r.errorCode === "choose_main" ? "More than one class has a main method. Pick the entry point in the toolbar." : r.error);
        else if (noMain && r.status === "completed") setMessage(noMain);
        setTab(r.status === "compile_failed" ? "problems" : "output");
        if (r.trace) {
          const sources = Object.fromEntries(files.map((f) => [f.path, f.content]));
          const i = interpret(r.trace, sources);
          setInterp(i);
          setInputReplay(replayInput(r.trace, sources));
          setStep(0);
          setPlaying(i.steps.length > 1);
          if (r.trace.truncated && r.trace.stopReason === "max_steps") {
            setMessage(`Recording stopped after ${r.trace.stepCount} steps. The steps so far can be played back.`);
          }
          if (layout === "code") setLayout("split");
        }
        return r;
      } catch (e) {
        const err = e as RunnerError;
        if (err.code === "aborted") setPhase("cancelled");
        else if (err.code === "runner_offline") {
          setPhase("offline");
          setMessage(err.message);
        } else {
          setPhase("failed");
          setMessage(err.message);
        }
      } finally {
        job.current = null;
      }
      return null;
    },
    [project, layout, runTarget, active, activePy, activeNative],
  );

  /* Expected Output & Given Inputs: run the current (unsaved) code with the given input. */
  /* It runs the file that is open, and only that file: a Java file with main, or a Python, C, or C++
     source file. Anything else gets a reason instead of running some other file. */
  const ioPath = !active ? ""
    : /\.(py|c|cpp|cc|cxx)$/.test(active.path) ? active.path
      : active.path.endsWith(".java") && activeMain ? active.path
        : "";
  const ioName = active?.path.split("/").pop() ?? "";
  const ioHint = !active ? "Open a file to run it here."
    : ioPath ? null
      : active.path.endsWith(".java") ? `${ioName} has no main method, so it can't run on its own. Open a file with public static void main(String[] args).`
        : /\.(h|hpp|hh|hxx)$/.test(active.path) ? `${ioName} is a header, so it can't run on its own. Open the .c or .cpp file with main().`
          : `${ioName} is not a program. Open a Java, Python, C, or C++ file to run it.`;
  /* The Given input field edits the open program's own saved input. */
  const ioInput = ioPath ? project.inputs[ioPath] ?? "" : "";
  const setIoInput = (v: string) => { if (ioPath) setProject((p) => ({ ...p, inputs: { ...p.inputs, [ioPath]: v } })); };
  const ioLanguage = ioPath.endsWith(".py") ? "Python" : /\.c$/.test(ioPath) ? "C" : /\.(cpp|cc|cxx)$/.test(ioPath) ? "C++" : ioPath.endsWith(".java") ? "Java" : null;
  const ioSource = project.files.find((f) => f.path === ioPath)?.content ?? "";
  const runIo = async () => {
    if (!ioPath || job.current) return;
    setIoRunning(true);
    const input = ioInput;
    const source = ioSource;
    const r = await execute("run", { stdin: input, mainClass: ioPath.endsWith(".java") ? classFor(ioPath, source) : ioPath });
    if (r) setIoRun({ result: r, input, file: ioPath, source });
    setIoRunning(false);
  };
  const openIo = () => {
    setRightTab("io");
    if (layout === "code") setLayout("split");
  };

  /* What the code writer sees: the open file, any selection, and real run results only. */
  const diagnosticsText = (r: ExecResult | null | undefined) => (r?.diagnostics ?? []).map((d) => `${d.file}:${d.line}: ${d.message}`).join("\n") || undefined;
  /* The language the assistant writes: the open file's, never a default (a header takes its folder's language). */
  const aiLanguageFor = (path: string | null | undefined): AiLanguage | null => languageOfPath(path) ?? (nativeLang(path) as AiLanguage | null);
  /*
   * Other files that matter for a request, by relevance and bounded: headers and modules the file
   * includes or imports, then sources next to it in the same language. At most 6 files and 60 KB;
   * data files and unrelated folders are never sent.
   */
  const relatedFiles = (f: { path: string; content: string }, lang: AiLanguage) => {
    const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/") + 1) : "";
    const byPath = new Map(project.files.map((x) => [x.path, x]));
    const wanted: string[] = [];
    const push = (p: string) => { if (p !== f.path && byPath.has(p) && !wanted.includes(p)) wanted.push(p); };
    if (lang === "c" || lang === "cpp") for (const m of f.content.matchAll(/#include\s+"([^"]+)"/g)) push(dir + m[1]);
    if (lang === "python") for (const m of f.content.matchAll(/^\s*(?:from\s+(\.?[\w.]+)\s+import|import\s+([\w.]+))/gm)) {
      const mod = (m[1] ?? m[2]).replace(/^\./, "").replace(/\./g, "/");
      push(dir + mod + ".py"); push(mod + ".py"); push(dir + mod + "/__init__.py");
    }
    for (const x of project.files) if (x.path.startsWith(dir) && !x.path.slice(dir.length).includes("/") && aiLanguageFor(x.path) === lang) push(x.path);
    const out: { path: string; content: string }[] = [];
    let bytes = 0;
    for (const p of wanted) {
      const content = byPath.get(p)!.content.slice(0, 20_000);
      if (out.length >= 6 || bytes + content.length > 60_000) break;
      out.push({ path: p, content });
      bytes += content.length;
    }
    return out;
  };
  const assistContext = (mode: AssistMode): AssistContext => {
    const usesIo = mode === "explain_output" || mode === "compare_output";
    const filePath = usesIo && ioPath ? ioPath : project.active;
    const f = project.files.find((x) => x.path === filePath);
    const lang = aiLanguageFor(f?.path);
    /* Run evidence only from a run of this program: same language, same folder. */
    const candidate = usesIo ? ioRun?.result ?? null : result;
    const runDir = (p?: string | null) => (p && p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "");
    const sameProgram = !!candidate && !!f && (candidate.language ?? "java") === (lang === "cpp" || lang === "c" || lang === "python" ? lang : "java")
      && (!candidate.entryPoint || runDir(candidate.entryPoint.includes("/") || /\.(py|c|cpp|cc|cxx)$/.test(candidate.entryPoint) ? candidate.entryPoint : f.path) === runDir(f.path));
    const r = sameProgram ? candidate : null;
    const evidence: string[] = [];
    if (r?.exception) evidence.push(`Uncaught ${r.exception.type}${r.exception.message ? `: ${r.exception.message}` : ""}${r.exception.line ? ` at line ${r.exception.line}` : ""}`);
    for (const i of r?.memoryIssues ?? []) evidence.push(`${i.tool}: ${i.title}${i.message ? ` (${i.message})` : ""}${i.line ? ` at ${i.file}:${i.line}` : ""}`);
    const traceSummary = r?.trace ? `The visualizer recorded ${r.trace.stepCount} steps${r.trace.truncated ? " (stopped at the step limit)" : ""}.` : "";
    if (traceSummary) evidence.push(traceSummary);
    return {
      language: lang ?? undefined,
      files: f && lang ? relatedFiles(f, lang) : undefined,
      runtime: evidence.length ? evidence.join("\n") : undefined,
      file: f ? { path: f.path, content: f.content } : undefined,
      selection: !usesIo && selection.current.trim() ? selection.current : undefined,
      input: usesIo ? ioRun?.input ?? (ioInput || undefined) : (active ? project.inputs[active.path] : undefined) || undefined,
      expectedOutput: ioExpected.trim() ? ioExpected : undefined,
      context: ioContext.trim() ? ioContext : undefined,
      execution: r && r.status !== "queued"
        ? { status: r.status, stdout: r.stdout, stderr: r.stderr, exitCode: typeof r.exitCode === "number" ? r.exitCode : null, diagnostics: diagnosticsText(r) }
        : undefined,
    };
  };
  /* Applying replaces the file's text (unsaved, so Undo and Ctrl+Z work), or adds the file a translation created. */
  const applySuggestion = (path: string, code: string) =>
    setProject((p) => (p.files.some((f) => f.path === path)
      ? { ...p, files: p.files.map((f) => (f.path === path ? { ...f, content: code } : f)), active: path, open: p.open.includes(path) ? p.open : [...p.open, path] }
      : persist(addFile(p, path, code))));
  const discardSuggestion = (path: string) => setProject((p) => persist(deleteFile(p, path)));
  /* The suggestion, compiled (or syntax-checked) in the sandbox with the rest of the project unchanged. */
  const checkSuggestion = async (path: string, code: string): Promise<CheckResult> => {
    const lang = aiLanguageFor(path) ?? aiLanguageFor(project.active);
    const tool = lang === "python" ? "Python 3.12's syntax check" : lang === "c" ? "gcc 13 (C17)" : lang === "cpp" ? "g++ 13 (C++20)" : "javac (Java 21)";
    if (!lang) return { ok: false, text: "Unknown language.", tool, unavailable: true };
    const files = project.files.some((f) => f.path === path)
      ? project.files.map((f) => ({ path: f.path, content: f.path === path ? code : f.content }))
      : [...project.files.map((f) => ({ path: f.path, content: f.content })), { path, content: code }];
    const source = /\.(h|hpp|hh|hxx)$/.test(path) && active && /\.(c|cpp|cc|cxx)$/.test(active.path) ? active.path : path;
    try {
      const started = await startExecution({ mode: "compile", files, language: lang, mainClass: lang === "java" ? null : source });
      const done = await waitForExecution(started.id, () => {}, AbortSignal.timeout(90_000));
      const res = done.result;
      if (!res) return { ok: false, text: "The check did not finish.", tool, unavailable: true };
      return { ok: res.status === "completed", text: diagnosticsText(res) || res.error || "", tool };
    } catch (e) {
      return { ok: false, text: e instanceof RunnerError && e.code === "runner_offline" ? "The code runner is offline, so the suggestion could not be checked." : "The suggestion could not be checked.", tool, unavailable: true };
    }
  };

  /* Stop asks the runner to kill the real process tree; polling then reports "cancelled". */
  const stop = useCallback(async () => {
    const j = job.current;
    if (!j) return;
    if (j.id) await cancelExecution(j.id).catch(() => j.abort.abort());
    else j.abort.abort();
  }, []);

  /* ---------------- Playback ---------------- */

  const steps = interp?.steps ?? [];
  /* The recorded steps with frame details carried forward, and when each implementation first ran. */
  const rawSteps = useMemo(() => (result?.trace && interp ? normalizeTrace(result.trace) : null), [result, interp]);
  const calls = useMemo(() => (rawSteps ? firstCalls(rawSteps) : null), [rawSteps]);
  /* Subproblems, dependencies, and cache use, read from the same recording (null when not DP-shaped). */
  const dpModel = useMemo(() => (rawSteps && interp ? buildDp(rawSteps, interp.steps) : null), [rawSteps, interp]);
  /* The Pascal's triangle implementations in the project, next to the open one when it is one of them. */
  const dpApproaches = useMemo(() => {
    const LABELS: Record<string, string> = {
      "PascalTriangle.java": "Bottom-up", "PascalTriangleMemoized.java": "Memoized", "PascalTriangleNaive.java": "No cache",
      "pascal_triangle.py": "Bottom-up", "pascal_memo.py": "Memoized", "pascal_naive.py": "No cache",
    };
    const near = active && LABELS[active.path.split("/").pop()!] ? active.path.slice(0, active.path.lastIndexOf("/") + 1) : null;
    const dir = near ?? project.files.find((f) => LABELS[f.path.split("/").pop()!])?.path.replace(/[^/]*$/, "") ?? null;
    if (dir === null) return [];
    return Object.keys(LABELS)
      .map((name) => project.files.find((f) => f.path === dir + name))
      .filter((f): f is NonNullable<typeof f> => !!f)
      .map((f) => ({ path: f.path, label: LABELS[f.path.split("/").pop()!], active: f.path === active?.path }));
  }, [project.files, active]);
  /* Every clean compile brings javac's class model; a failed one marks the last model out of date. */
  useEffect(() => {
    if (!result || result.status === "queued") return;
    if (result.hierarchy) setClassModel({ classes: result.hierarchy as ClassModel[], failed: false, key: filesKey(projectRef.current) });
    else if (result.status === "compile_failed") setClassModel((m) => ({ ...m, failed: true }));
  }, [result]);
  const current = steps[step] ?? null;
  const atEnd = step >= steps.length - 1;
  useEffect(() => {
    if (!playing || atEnd) return;
    const t = setTimeout(() => setStep((s) => Math.min(s + 1, steps.length - 1)), 700 / speed);
    return () => clearTimeout(t);
  }, [playing, step, speed, steps.length, atEnd]);

  /* Follow the execution into whichever file it is in. */
  useEffect(() => {
    setMobileFiles(false);
  }, [project.active]);
  const currentFile = current?.file ?? null;
  /*
   * The editor follows the run until the user opens another file themselves; then a recording that
   * finishes later, or playback reaching another file, no longer pulls them back. Using the playback
   * controls means watching the run again, so following resumes.
   */
  const following = useRef(true);
  const autoOpened = useRef<string | null>(null);
  useEffect(() => {
    if (project.active && autoOpened.current !== null && project.active !== autoOpened.current) following.current = false;
  }, [project.active]);
  useEffect(() => {
    if (!currentFile || !following.current) return;
    autoOpened.current = currentFile;
    setProject((p) => (p.files.some((f) => f.path === currentFile) && p.active !== currentFile ? openFile(p, currentFile) : p));
  }, [currentFile]);
  const resumeFollow = useCallback(() => {
    following.current = true;
    if (!currentFile) return;
    autoOpened.current = currentFile;
    setProject((p) => (p.files.some((f) => f.path === currentFile) && p.active !== currentFile ? openFile(p, currentFile) : p));
  }, [currentFile]);

  /* ---------------- Editor markers ---------------- */

  const diagnostics: Diagnostic[] = useMemo(() => {
    const list = [...(result?.diagnostics ?? [])];
    /* What the sanitizers found in a C or C++ run, on the lines they name. */
    for (const issue of result?.memoryIssues ?? []) {
      list.push({ file: issue.file ?? null, line: issue.line ?? null, column: null, severity: issue.kind === "leak" ? "warning" : "error", message: describeIssue(issue) } as (typeof list)[number]);
    }
    const ex = result?.exception;
    if (ex?.line) {
      const mapped = ex.sourcePath ? result?.trace?.sourceMap?.[ex.sourcePath] : undefined;
      const byName = project.files.find((f) => ex.sourcePath && f.path.endsWith(ex.sourcePath.split("/").pop()!))?.path;
      list.push({ severity: "error", file: mapped ?? byName ?? null, line: ex.line, column: null, message: `${ex.type}${ex.message ? `: ${ex.message}` : ""}` });
    }
    return list;
  }, [result, project.files]);
  const markers: EditorMarker[] = useMemo(
    () => diagnostics.filter((d) => d.file === project.active && d.line).map((d) => ({ line: d.line!, column: d.column, severity: d.severity, message: d.message })),
    [diagnostics, project.active],
  );
  const execLine = current && current.file === project.active ? current.line : null;
  /* Output follows playback only for the visualized run itself; a Run or Compile shows all of its output. */
  /* At the last step of a recording that ran to the end, the program has finished: show all of its output.
     (A Python recording's last step comes just before its last line runs, so that line's output is after it.) */
  const showAllOutput = atEnd && !!interp && !(result?.trace as { truncated?: boolean } | undefined)?.truncated;
  const stdout = interp && current && result?.mode === "trace" && result.stdout !== undefined ? (showAllOutput ? result.stdout : result.stdout.slice(0, current.out)) : (result?.stdout ?? "");

  /* ---------------- File actions ---------------- */

  const onChange = useCallback((path: string, value: string) => setProject((p) => setContent(p, path, value)), []);
  const createFile = (path: string) => {
    const err = validatePath(path, project.files.map((f) => f.path));
    if (err) return err;
    if (project.files.length >= MAX_FILES) return `Projects hold up to ${MAX_FILES} files. Delete one first.`;
    setProject((p) => persist(addFile(p, path, newClassSource(path))));
    return null;
  };
  const rename = (from: string, to: string) => {
    if (from === to) return null;
    const err = validatePath(to, project.files.map((f) => f.path), from);
    if (err) return err;
    setProject((p) => persist(renameFile(p, from, to)));
    return null;
  };
  const newFolder = (path: string) => {
    const err = validateFolder(path, project);
    if (err) return err;
    setProject((p) => persist(createFolder(p, path)));
    return null;
  };
  const moveFolder = (from: string, to: string) => {
    if (from === to) return null;
    if (to.startsWith(from + "/")) return "A folder cannot move inside itself.";
    const err = validateFolder(to, project, from);
    if (err) return err;
    const clash = filesIn(project, from).find((f) => project.files.some((x) => x.path === to + f.path.slice(from.length)));
    if (clash) return `${to + clash.path.slice(from.length)} already exists.`;
    setProject((p) => persist(renameFolder(p, from, to)));
    return null;
  };
  const removeFolder = (path: string) => {
    const inside = filesIn(project, path);
    if (!inside.length) return setProject((p) => persist(deleteFolder(p, path)));
    setConfirm({
      title: `Delete ${path} and its ${inside.length} file${inside.length === 1 ? "" : "s"}?`,
      body: `${inside.slice(0, 4).map((f) => f.path).join(", ")}${inside.length > 4 ? ", …" : ""} will be removed, including any unsaved changes in them. Files outside ${path} are not affected.`,
      action: "Delete folder",
      danger: true,
      onConfirm: () => setProject((p) => persist(deleteFolder(p, path))),
    });
  };
  const remove = (path: string) =>
    setConfirm({
      title: `Delete ${path}?`,
      body: "This removes the file from your project, including any unsaved changes in it.",
      action: "Delete",
      danger: true,
      onConfirm: () => setProject((p) => persist(deleteFile(p, path))),
    });
  const close = (path: string) => {
    const f = project.files.find((x) => x.path === path);
    if (f && isDirty(f)) {
      setConfirm({
        title: `${path.split("/").pop()} has unsaved changes`,
        body: "Closing the tab keeps your edits for this session. Save to keep them after you leave.",
        action: "Close tab",
        onConfirm: () => setProject((p) => closeTab(p, path)),
      });
    } else setProject((p) => closeTab(p, path));
  };
  /* Imported files join the project; a different file at the same path is replaced only when chosen. */
  const importFiles = (files: { path: string; content: string }[], replace: Set<string>) => {
    const p = projectRef.current;
    const next = addFiles(p, files, { replace, saved: true });
    if (!next) {
      setMessage(`That import would take the project past ${MAX_FILES} files. Nothing was imported.`);
      return;
    }
    const plan = planAdd(p, files);
    const added = plan.filter((f) => f.status === "new").length;
    const kept = plan.filter((f) => f.status === "conflict" && !replace.has(f.path)).length;
    const first = plan.find((f) => f.status === "new" || replace.has(f.path))?.path ?? files[0].path;
    setProject(persist(openFile(next, first)));
    setMessage(`Imported ${added} new file${added === 1 ? "" : "s"}${replace.size ? `, replaced ${replace.size}` : ""}${kept ? `, kept your version of ${kept}` : ""}.`);
    setImporting(false);
  };
  const jump = (file: string) => setProject((p) => openFile(p, file));
  const jumpTo = (file: string, line: number | null) => {
    setProject((p) => (p.files.some((f) => f.path === file) ? openFile(p, file) : p));
    if (line) setReveal({ path: file, line, nonce: Date.now() });
  };

  /* ---------------- Shortcuts ---------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "Enter") {
        e.preventDefault();
        execute(e.shiftKey ? "trace" : "run");
      } else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        setProject((p) => save(p));
      } else if (e.key === "Escape") {
        setConfirm(null);
        setImporting(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [execute, save]);

  /* ---------------- Resizing ---------------- */

  const drag = (kind: "terminal" | "right") => (e: React.PointerEvent) => {
    e.preventDefault();
    const rect = mainRef.current?.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      if (!rect) return;
      if (kind === "terminal") setTerminalHeight(Math.min(Math.max(rect.bottom - ev.clientY, 90), rect.height - 140));
      else setRightWidth(Math.min(Math.max((rect.right - ev.clientX) / rect.width, 0.25), 0.75));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const sandbox = runtime?.sandbox.level;
  const showRight = layout !== "code";
  /* Variables live in the scene: docked over a drawn structure, or the whole view when there is none. */
  const sceneDrawn = !!interp && (interp.layers.length >= 2 || !!interp.structure || !!interp.array);
  const scopeMode: "docked" | "stage" | null = !interp ? null : sceneDrawn ? "docked" : inputReplay ? null : "stage";
  const rightPct = layout === "visualize" ? 0.66 : rightWidth;

  /* Playback controls, shared by every view that follows the recorded run (Visualize, Inheritance, Dynamic programming). */
  const playback = interp ? (
                <div className="shrink-0 border-t border-white/10 px-4 py-3">
                  <div className="flex items-center gap-1">
                    <button onClick={() => { resumeFollow(); setPlaying(false); setStep((s) => Math.max(0, s - 1)); }} className={iconBtn} aria-label="Previous step"><PrevIcon /></button>
                    <button
                      onClick={() => {
                        resumeFollow();
                        if (atEnd) {
                          setStep(0);
                          setPlaying(true);
                        } else setPlaying((p) => !p);
                      }}
                      className={`${iconBtn} bg-white/10`}
                      aria-label={playing && !atEnd ? "Pause" : "Play"}
                    >
                      {playing && !atEnd ? <PauseIcon /> : <PlayIcon />}
                    </button>
                    <button onClick={() => { resumeFollow(); setPlaying(false); setStep((s) => Math.min(steps.length - 1, s + 1)); }} className={iconBtn} aria-label="Next step"><NextIcon /></button>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(steps.length - 1, 0)}
                      value={step}
                      onChange={(e) => { resumeFollow(); setPlaying(false); setStep(Number(e.target.value)); }}
                      className="mx-2 h-1 min-w-0 flex-1 accent-[#6fe9ff]"
                      aria-label="Recorded step"
                    />
                    <span className="w-24 text-right text-[12px] tabular-nums text-zinc-500">{step + 1} / {steps.length}</span>
                    <button onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])} className="ml-1 w-11 rounded-full border border-white/15 py-0.5 text-[12px] tabular-nums text-zinc-400 hover:text-zinc-100">{speed}×</button>
                  </div>
                  {current && (
                    <div className="mt-2 grid gap-1 text-[13px]">
                      <p className="cv-glass-panel text-[15px] text-zinc-100" aria-live="polite">{current.note}</p>
                      <p className="truncate text-zinc-500" style={{ fontFamily: monoFont }}>
                        {current.frames.map((f) => `${f.method}():${f.line}`).join("  ‹  ")}
                      </p>
                      {!scopeMode && current.vars.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1" style={{ fontFamily: monoFont }}>
                          {current.vars.map((v) => (
                            <span key={v.name} className={`rounded-md px-2 py-0.5 text-[12px] transition ${v.changed ? "bg-[#8f6bff]/20 text-zinc-50" : "bg-white/5 text-zinc-300"}`}>
                              <span className="text-zinc-500">{v.name} =</span> {v.value}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
  ) : null;

  return (
    <div className="flex h-svh flex-col bg-black text-zinc-100 antialiased">
      <style>{`
        @keyframes cv-line-in { from { background-color: rgba(111,233,255,0.22); } }
        @keyframes cv-progress { from { transform: translateX(-100%); } to { transform: translateX(300%); } }
      `}</style>

      {/* On a phone the header scrolls sideways inside itself if it must, so it can never widen the page. */}
      <header className="cv-glass-header relative flex h-13 shrink-0 items-center gap-2 overflow-x-auto overflow-y-hidden whitespace-nowrap border-b border-white/10 px-3 [scrollbar-width:none] [&>*]:shrink-0">
        <Link href="/" aria-label="codeviz home" className="flex items-center gap-1.5 rounded-full py-1.5 pl-2 pr-3 text-[15px] font-bold tracking-tight transition hover:bg-white/10">
          <BackIcon className="text-zinc-500" />
          <span className="hidden sm:inline">codeviz</span>
        </Link>
        <button onClick={toggleFiles} className={`${btn} text-zinc-400 hover:bg-white/10 hover:text-zinc-100`} aria-pressed={explorer} aria-expanded={mobileFiles || undefined}>
          Files
        </button>
        <button onClick={() => setImporting(true)} className={`${btn} text-zinc-400 hover:bg-white/10 hover:text-zinc-100`}>
          Import
        </button>
        {/* No inline-flex from btn here: two display utilities on one element depend on stylesheet order. */}
        <button onClick={openIo} className={`${btn.replace("inline-flex ", "")} hidden text-zinc-400 hover:bg-white/10 hover:text-zinc-100 xl:inline-flex`}>Expected Output &amp; Given Inputs</button>
        <span className="mx-1 hidden h-5 w-px bg-white/10 md:block" aria-hidden="true" />
        <span className="hidden max-w-56 truncate text-[13px] text-zinc-300 lg:inline">My project</span>
        <span className="mx-1 hidden h-5 w-px bg-white/10 md:block" aria-hidden="true" />
        <span
          className="hidden items-center gap-2 text-[12px] text-zinc-500 md:flex"
          title={runtimeError ?? (sandbox === "unavailable" ? runtime?.docker?.problem ?? "Docker is not available." : sandbox === "partial" ? "This runner cannot isolate network access on its host." : sandbox === "docker" ? "Each run uses its own locked-down container." : "Programs run without network access and with time, memory, and output limits, but can reach the files on this machine. Use Docker mode for code you did not write.")}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${!runtime || sandbox === "unavailable" ? "bg-[#ff5d73]" : sandbox === "partial" ? "bg-[#f2c94c]" : "bg-[#5fd9c0]"}`} />
          {!runtime
            ? "Runner offline"
            : sandbox === "unavailable"
              ? "Docker unavailable"
              : `${activePy ? (runtime.python?.available ? `Python ${runtime.python.version}` : "Python not available") : activeNative ? (activeNative === "cpp" ? "C++20 · g++" : "C17 · gcc") : `Java ${runtime.javaVersion.split("+")[0]}`}, ${sandbox === "docker" ? "Docker sandbox" : sandbox === "partial" ? "partial sandbox" : "process sandbox"}`}
        </span>
        <div className="flex-1" />

        {mains.length > 1 && !activePy && !activeNative && (
          <select
            value={activeMain ?? chosenMain ?? ""}
            /* Choosing an entry point opens its file, so the file on screen is the one that runs. */
            onChange={(e) => {
              const cls = e.target.value || null;
              const file = cls ? project.files.find((f) => classFor(f.path, f.content) === cls) : undefined;
              setProject((p) => {
                const next = { ...p, mainClass: cls };
                return file ? showInCurrentTab(next, file.path) : next;
              });
            }}
            className="h-8 max-w-44 rounded-full border border-white/15 bg-black px-3 text-[12px] text-zinc-200 outline-none focus:border-[#6fe9ff]/60"
            aria-label="Entry point"
          >
            <option value="">Choose entry point</option>
            {mains.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        )}

        <div className="hidden items-center rounded-full border border-white/10 p-0.5 sm:flex" role="group" aria-label="Layout">
          {(["code", "split", "visualize"] as Layout[]).map((l) => (
            <button key={l} onClick={() => setLayout(l)} className={`h-7 rounded-full px-3 text-[12px] capitalize transition ${layout === l ? "bg-white/10 text-zinc-50" : "text-zinc-500 hover:text-zinc-200"}`} aria-pressed={layout === l}>
              {l}
            </button>
          ))}
        </div>

        <button onClick={() => execute("compile")} disabled={busy} className={`${btn} text-zinc-300 hover:bg-white/10`}>Compile</button>
        {busy ? (
          <button onClick={stop} className={`${btn} border border-[#ff5d73]/40 text-[#ff8a9a] hover:bg-[#ff5d73]/10`}>Stop</button>
        ) : (
          <>
            <button onClick={() => execute("trace")} className={`${btn} border border-[#6fe9ff]/35 text-[#9ee8ff] hover:bg-[#6fe9ff]/10`} title="Ctrl+Shift+Enter">Visualize</button>
            <button onClick={() => execute("run")} className={`${btn} bg-zinc-50 font-semibold text-black hover:bg-white`} title="Ctrl+Enter">
              <PlayIcon /> Run
            </button>
          </>
        )}
        {busy && (
          <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px overflow-hidden" aria-hidden="true">
            <span className="block h-px w-1/3 bg-gradient-to-r from-transparent via-[#6fe9ff] to-transparent" style={{ animation: "cv-progress 1.1s linear infinite" }} />
          </span>
        )}
      </header>

      <div ref={mainRef} className="flex min-h-0 flex-1">
        {mobileFiles && <button className="fixed inset-0 z-30 bg-black/60 md:hidden" aria-label="Close the file explorer" onClick={() => setMobileFiles(false)} />}
        {(explorer || mobileFiles) && (
          <aside
            aria-label="File explorer"
            className={`cv-glass-side ${mobileFiles ? "fixed inset-y-0 left-0 z-40 flex w-72 max-w-[85vw] shadow-2xl" : "hidden"} w-64 shrink-0 flex-col border-r border-white/10 md:static md:z-auto md:w-64 md:max-w-none md:shadow-none ${explorer ? "md:flex" : "md:hidden"}`}
          >
            <div className="min-h-0 flex-1">
              <FileExplorer project={project} onOpen={(p) => setProject((x) => openFile(x, p))} onCreate={createFile} onRename={rename} onDelete={remove}
                onCreateFolder={newFolder} onRenameFolder={moveFolder} onDeleteFolder={removeFolder}
                onAddExamples={() => { setExamplesOpen(true); requestAnimationFrame(() => examplesRef.current?.scrollIntoView({ block: "nearest" })); }} />
            </div>
            {/* Clicking an example adds its files to the explorer above; this list stays put for the next one. */}
            <section ref={examplesRef} aria-label="Examples" className={`flex shrink-0 flex-col border-t border-white/10 ${examplesOpen ? "h-[44%] min-h-44" : ""}`}>
              <button onClick={() => setExamplesOpen((o) => !o)} aria-expanded={examplesOpen} className="flex shrink-0 items-center gap-1.5 px-3 py-2 text-left text-[11px] font-medium text-zinc-500 hover:text-zinc-300">
                <span className={`inline-block text-[9px] transition-transform ${examplesOpen ? "rotate-90" : ""}`} aria-hidden="true">▸</span>
                Examples
                <span className="font-normal text-zinc-600">{addedExamples.size ? `${addedExamples.size} in project` : "click to add"}</span>
              </button>
              {examplesOpen && (
                <div className="min-h-0 flex-1 overflow-auto">
                  <LibraryPanel added={addedExamples} onOpenExample={addExample} />
                </div>
              )}
            </section>
          </aside>
        )}

        <div className={`flex min-w-0 flex-1 flex-col ${layout === "visualize" ? "max-lg:hidden" : ""}`}>
          <div className="cv-glass-header flex h-10 shrink-0 items-end gap-0.5 overflow-x-auto border-b border-white/10 px-2">
            {project.open.map((path) => {
              const f = project.files.find((x) => x.path === path);
              if (!f) return null;
              const isActive = path === project.active;
              return (
                <div key={path} className={`flex items-center gap-1 rounded-t-lg border-x border-t px-3 py-1.5 text-[12px] transition ${isActive ? "border-white/10 bg-[#05070b] text-zinc-100" : "border-transparent text-zinc-500 hover:text-zinc-300"}`}>
                  <button onClick={() => setProject((p) => openFile(p, path))} className="max-w-48 truncate" title={path}>{path.split("/").pop()}</button>
                  {isDirty(f) ? <span className="h-1.5 w-1.5 rounded-full bg-[#6fe9ff]" aria-label="Unsaved" /> : null}
                  <button onClick={() => close(path)} className="ml-1 rounded px-1 text-zinc-600 hover:bg-white/10 hover:text-zinc-200" aria-label={`Close ${path}`}>×</button>
                </div>
              );
            })}
            <div className="flex-1" />
            <div className="flex items-center gap-1 pb-1.5 text-[12px] text-zinc-500">
              <button onClick={() => setProject((p) => ({ ...p, fontSize: Math.max(11, p.fontSize - 1) }))} className="rounded px-1.5 hover:bg-white/10 hover:text-zinc-200" aria-label="Smaller text">A−</button>
              <span className="tabular-nums">{project.fontSize}</span>
              <button onClick={() => setProject((p) => ({ ...p, fontSize: Math.min(22, p.fontSize + 1) }))} className="rounded px-1.5 hover:bg-white/10 hover:text-zinc-200" aria-label="Larger text">A+</button>
              <button onClick={() => setProject((p) => save(p))} disabled={!dirty} className="ml-2 rounded-full px-2.5 py-0.5 text-zinc-300 hover:bg-white/10 disabled:opacity-30" title="Ctrl+S">Save</button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            {active ? (
              <CodeEditor path={active.path} value={active.content} onChange={onChange} activeLine={execLine} markers={markers} fontSize={project.fontSize} fontFamily={monoFont}
                  reveal={reveal && reveal.path === active.path ? reveal : null}
                  onSelection={(t) => (selection.current = t)} />
            ) : (
              <div className="cv-glass-editor flex h-full flex-col items-center justify-center gap-3 text-sm text-zinc-500">
                <p>Open a file from the list, or start a new one.</p>
                <button onClick={() => setImporting(true)} className="rounded-full border border-white/15 px-4 py-1.5 text-zinc-300 hover:border-white/30">Import Java files</button>
              </div>
            )}
          </div>

          <div onPointerDown={drag("terminal")} className="h-1 shrink-0 cursor-row-resize bg-white/5 transition hover:bg-[#6fe9ff]/40" role="separator" aria-orientation="horizontal" aria-label="Resize terminal" />
          <div style={{ height: terminalHeight }} className="shrink-0">
            <TerminalPanel
              tab={tab}
              setTab={setTab}
              phase={phase}
              result={result}
              message={message}
              stdout={stdout}
              diagnostics={diagnostics}
              live={live}
              onSend={(text, eof) => {
                const l = live;
                if (!l || !l.acceptsInput) return;
                /* Shown where the program was when it was typed, like a terminal echo. */
                if (text) setLive((x) => (x && x.id === l.id ? { ...x, echoes: [...x.echoes, { at: x.stdout.length, text }] } : x));
                sendInput(l.id, text, eof).catch(() => setMessage("The program is no longer reading input."));
              }}
              onJump={jump}
              onClear={() => {
                setResult(null);
                setMessage(null);
                setPhase("idle");
              }}
              fontFamily={monoFont}
            />
          </div>
        </div>

        {showRight && (
          <>
            <div onPointerDown={drag("right")} className="hidden w-1 shrink-0 cursor-col-resize bg-white/5 transition hover:bg-[#6fe9ff]/40 lg:block" role="separator" aria-orientation="vertical" aria-label="Resize visualizer" />
            <section
              aria-label="Visualizer"
              className={`min-w-0 flex-col border-l border-white/10 ${layout === "visualize" ? "flex flex-1 lg:flex-none" : "hidden lg:flex"}`}
              style={{ width: `${rightPct * 100}%` }}
            >
              <div className="cv-glass-header flex shrink-0 gap-0.5 border-b border-white/10 px-3 pt-2" role="tablist" aria-label="Right panel">
                {([["visualize", "Visualize"], ["memory", "Memory"], ["classes", "Inheritance"], ["dp", "Dynamic programming"], ["io", "Expected Output & Given Inputs"]] as const).map(([t, label]) => (
                  <button key={t} role="tab" aria-selected={rightTab === t} onClick={() => setRightTab(t)} className={`relative px-2.5 pb-2 pt-1 text-[12px] transition ${rightTab === t ? "text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}>
                    {label}
                    {rightTab === t && <span className="absolute inset-x-2 bottom-0 h-px bg-[#6fe9ff]" />}
                  </button>
                ))}
              </div>
              {rightTab === "memory" ? (
                <>
                <div className="relative min-h-0 flex-1">
                  <PanelBoundary name="Memory view">
                    <MemoryView
                      steps={(result?.trace?.steps as unknown as RawStep[] | undefined) ?? null}
                      stepIndex={step}
                      summary={(result?.trace as unknown as { memorySummary?: { leakedAtExit?: { id: number; size: number; file: string | null; line: number | null }[] | null } } | undefined)?.memorySummary}
                      ended={!!result && result.status !== "running"}
                      onJump={jumpTo}
                      onSeek={(s) => { setPlaying(false); setStep(s); }}
                      fontFamily={monoFont}
                    />
                  </PanelBoundary>
                </div>
                {playback}
                </>
              ) : rightTab === "dp" ? (
                <>
                <div className="relative min-h-0 flex-1">
                  <PanelBoundary name="Dynamic programming view">
                    <DpView
                      model={dpModel}
                      steps={rawSteps?.steps ?? null}
                      stepIndex={step}
                      onSeek={(s) => { setPlaying(false); setStep(s); }}
                      onJump={jumpTo}
                      rows={Math.max(1, Math.min(12, parseInt((active && project.inputs[active.path]) || "", 10) || dpModel?.rows || 6))}
                      onRows={(n) => {
                        const input = `${n}\n`;
                        if (active) setProject((p) => ({ ...p, inputs: { ...p.inputs, [active.path]: input } }));
                        void execute("trace", { stdin: input });
                      }}
                      approaches={dpApproaches}
                      onApproach={(path) => {
                        const f = project.files.find((x) => x.path === path);
                        if (!f) return;
                        setProject((p) => showInCurrentTab(p, path));
                        void execute("trace", { mainClass: f.path.endsWith(".py") ? f.path : classFor(f.path, f.content) });
                      }}
                      busy={busy}
                      fontFamily={monoFont}
                    />
                  </PanelBoundary>
                </div>
                {playback}
                </>
              ) : rightTab === "classes" ? (
                <>
                <div className="relative min-h-0 flex-1">
                  <PanelBoundary name="Inheritance view">
                  <InheritanceView
                    classes={classModel.classes}
                    status={classModel.classes ? "ready" : classModel.failed ? "compile_failed" : "none"}
                    stale={!!classModel.classes && (classModel.failed || classModel.key !== filesKey(project))}
                    step={rawSteps?.steps[step] ?? null}
                    heap={current?.scope?.heap ?? null}
                    stepIndex={step}
                    calls={calls}
                    onJump={jumpTo}
                    fontFamily={monoFont}
                  />
                  </PanelBoundary>
                </div>
                {playback}
                </>
              ) : rightTab === "io" ? (
                <div className="min-h-0 flex-1">
                  <IoAssistant
                    file={ioPath}
                    language={ioLanguage}
                    hint={ioHint}
                    input={ioInput}
                    onInput={setIoInput}
                    expected={ioExpected}
                    onExpected={setIoExpected}
                    context={ioContext}
                    onContext={setIoContext}
                    running={ioRunning}
                    run={ioRun}
                    currentSource={ioSource}
                    onRun={runIo}
                    onStop={stop}
                    onExplain={() => setAssistRequest({ mode: ioRun && ioExpected.trim() ? "compare_output" : ioRun ? "explain_output" : "predict_behavior", nonce: Date.now() })}
                    fontFamily={monoFont}
                  />
                </div>
              ) : (
              <>
              <div className="relative min-h-0 flex-1 overflow-hidden">
                <div className="cv-scene-scrim" aria-hidden="true" />
                <PanelBoundary key={interp ? "run" : "idle"} name="visualizer">
                {interp && interp.layers.length >= 2 ? (
                  <StructureVisualizer views={current?.layers ?? []} resetKey={resetKey} fontFamily={monoFont} className="absolute inset-0" />
                ) : interp?.structure ? (
                  <StructureVisualizer view={current?.structure ?? null} title={interp.title} resetKey={resetKey} fontFamily={monoFont} className="absolute inset-0" />
                ) : interp?.array ? (
                  <TraceVisualizer length={interp.array.length} view={current?.array ?? null} resetKey={resetKey} fontFamily={monoFont} className="absolute inset-0" />
                ) : inputReplay ? (
                  <InputStream replay={inputReplay} step={step} onSeek={(s) => { setPlaying(false); setStep(s); }} fontFamily={monoFont} />
                ) : interp ? (
                  <>
                    <SpaceScrim />
                    <p className="pointer-events-none absolute inset-x-0 bottom-3 z-10 px-6 text-center text-[12px] text-zinc-600">
                      This run builds no array, list, tree, graph, or map, so its calls and variables are the picture.
                    </p>
                  </>
                ) : (
                  <div className="relative flex h-full flex-col items-center justify-center px-8 text-center">
                    <SpaceScrim />
                    <p className="relative text-lg font-semibold tracking-tight text-zinc-200">Watch your code run</p>
                    <p className="relative mt-2 max-w-sm text-sm leading-relaxed text-zinc-500">
                      Visualize records your program&apos;s real execution, line by line, and draws its variables, calls, and the arrays, lists, trees, graphs, and maps it builds. Open an example to try it.
                    </p>
                    <button onClick={() => execute("trace")} disabled={busy} className="relative mt-5 rounded-full border border-[#6fe9ff]/35 px-4 py-1.5 text-sm text-[#9ee8ff] hover:bg-[#6fe9ff]/10 disabled:opacity-40">
                      Visualize
                    </button>
                  </div>
                )}
                {scopeMode && <ScopeOverlay scope={current?.scope ?? null} mode={scopeMode} step={step} fontFamily={monoFont} />}
                </PanelBoundary>
                {(interp?.array || interp?.structure || (interp?.layers.length ?? 0) >= 2) && (
                  <button onClick={() => setResetKey((k) => k + 1)} className="absolute right-3 top-3 rounded-full border border-white/15 px-3 py-1 text-[12px] text-zinc-400 hover:text-zinc-100">Reset view</button>
                )}
                {busy && <span className={`absolute left-4 top-3 animate-pulse text-[12px] ${phaseTone(phase)}`}>{PHASE_LABEL[phase]}…</span>}
              </div>
              {inputReplay && (interp?.array || interp?.structure || (interp?.layers.length ?? 0) >= 2) && (
                <div className="h-[44%] min-h-[220px] shrink-0 border-t border-white/10">
                  <InputStream replay={inputReplay} step={step} onSeek={(s) => { setPlaying(false); setStep(s); }} fontFamily={monoFont} compact />
                </div>
              )}

              {playback}
              </>
              )}
            </section>
          </>
        )}
      </div>

      {importing && <ImportDialog existing={project.files} onImport={importFiles} onClose={() => setImporting(false)} />}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="alertdialog" aria-modal="true" aria-label={confirm.title}>
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#05070b] p-6">
            <h2 className="text-lg font-semibold text-zinc-50">{confirm.title}</h2>
            <p className="mt-2 text-sm text-zinc-400">{confirm.body}</p>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button autoFocus onClick={() => setConfirm(null)} className="rounded-full px-4 py-2 text-sm text-zinc-400 hover:text-zinc-100">Cancel</button>
              {confirm.alt && (
                <button
                  onClick={() => {
                    setConfirm(null);
                    confirm.alt!.onClick();
                  }}
                  className="rounded-full border border-white/15 px-4 py-2 text-sm text-zinc-300 hover:border-white/30 hover:text-zinc-50"
                >
                  {confirm.alt.label}
                </button>
              )}
              <button
                onClick={() => {
                  setConfirm(null);
                  confirm.onConfirm();
                }}
                className={`rounded-full px-4 py-2 text-sm font-semibold ${confirm.danger ? "bg-[#ff5d73] text-black hover:bg-[#ff7a8c]" : "bg-zinc-50 text-black hover:bg-white"}`}
              >
                {confirm.action}
              </button>
            </div>
          </div>
        </div>
      )}
      <NemotronAssistant
        getContext={assistContext}
        getFile={(path) => project.files.find((f) => f.path === path)?.content ?? null}
        onApply={applySuggestion}
        onDiscard={discardSuggestion}
        onCheck={checkSuggestion}
        target={{ path: project.active, language: aiLanguageFor(project.active) }}
        request={assistRequest}
        fontFamily={monoFont}
      />
    </div>
  );
}
