"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CodeEditor, type EditorMarker } from "./code-editor";
import { FileExplorer } from "./file-explorer";
import { ImportDialog } from "./import-dialog";
import { TerminalPanel, PHASE_LABEL, phaseTone, type Phase } from "./terminal-panel";
import { TraceVisualizer } from "./trace-visualizer";
import { StructureVisualizer } from "./structure-visualizer";
import { LibraryPanel } from "./library-panel";
import { IoAssistant, type IoRun } from "./io-assistant";
import { NemotronAssistant, type AssistContext, type AssistMode } from "./nemotron-assistant";
import { exampleById } from "@/lib/examples/catalog";
import { InputStream } from "./input-stream";
import { replayInput, type InputReplay } from "@/lib/trace/input";
import { BackIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon } from "./icons";
import { interpret, type Interpretation } from "@/lib/trace/interpret";
import {
  STORAGE_KEY, addFile, closeTab, defaultProject, deleteFile, deserialize, isDirty, markSaved, newClassSource,
  openFile, packageOf, renameFile, serialize, setContent, validatePath, type Project,
} from "@/lib/workspace/project";
import {
  RunnerError, cancelExecution, getRuntime, startExecution, waitForExecution, type Diagnostic, type ExecResult, type Runtime,
} from "@/lib/workspace/runner-client";

type Layout = "code" | "split" | "visualize";
/* Each example is its own saved project, so switching never loses work. */
type Context = { kind: "project" } | { kind: "example"; id: string };

/** The class to run for a file: its package (from the source) plus its file name. */
function classFor(path: string, content: string) {
  const base = path.split("/").pop()!.replace(/\.java$/, "");
  const pkg = /^\s*package\s+([\w.]+)\s*;/m.exec(content)?.[1];
  return pkg ? `${pkg}.${base}` : base;
}
const keyFor = (c: Context) => (c.kind === "project" ? STORAGE_KEY : `codeviz.${c.kind}.${c.id}.v1`);

async function initialProject(c: Context, fontSize: number): Promise<Project> {
  if (c.kind === "example") {
    const ex = exampleById(c.id)!;
    const res = await fetch(`/examples/${ex.file}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Could not load ${ex.file}.`);
    const content = await res.text();
    return { files: [{ path: ex.file, content, saved: content }], open: [ex.file], active: ex.file, mainClass: null, stdin: ex.stdin ?? "", fontSize };
  }
  return markSaved(defaultProject());
}
type Confirm = { title: string; body: string; action: string; danger?: boolean; onConfirm: () => void };
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
  const [terminalHeight, setTerminalHeight] = useState(220);
  const [rightWidth, setRightWidth] = useState(0.42);
  const [tab, setTab] = useState<"output" | "problems" | "input">("output");
  const [importing, setImporting] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [context, setContext] = useState<Context>({ kind: "project" });
  const [sideTab, setSideTab] = useState<"files" | "examples">("files");
  const [rightTab, setRightTab] = useState<"visualize" | "io">("visualize");
  /* Expected Output & Given Inputs: kept here so the code writer can use the same run. */
  const [ioFile, setIoFile] = useState("");
  const [ioInput, setIoInput] = useState("");
  const [ioExpected, setIoExpected] = useState("");
  const [ioContext, setIoContext] = useState("");
  const [ioRun, setIoRun] = useState<IoRun | null>(null);
  const [ioRunning, setIoRunning] = useState(false);
  const [assistRequest, setAssistRequest] = useState<{ mode: AssistMode; nonce: number } | null>(null);
  const selection = useRef("");
  const buffers = useRef(new Map<string, Project>());
  const contextRef = useRef<Context>(context);
  const job = useRef<{ id: string | null; abort: AbortController } | null>(null);
  const mainRef = useRef<HTMLDivElement>(null);

  /* Load the saved project and ask the runner what it can do. */
  useEffect(() => {
    const saved = deserialize(localStorage.getItem(STORAGE_KEY));
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

  /* Saving writes the files; settings such as input and font size are kept without a save. */
  const save = useCallback((p: Project) => {
    const next = markSaved(p);
    localStorage.setItem(keyFor(contextRef.current), serialize(next));
    return next;
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    const key = keyFor(context);
    const stored = deserialize(localStorage.getItem(key));
    if (!stored) return;
    localStorage.setItem(key, serialize({ ...stored, mainClass: project.mainClass, stdin: project.stdin, fontSize: project.fontSize }));
  }, [project.mainClass, project.stdin, project.fontSize, hydrated, context]);

  /* Switch between your project, an example, or a problem, keeping unsaved edits in memory. */
  const openContext = useCallback(
    async (next: Context) => {
      if (job.current) return;
      buffers.current.set(keyFor(contextRef.current), project);
      const key = keyFor(next);
      let p = buffers.current.get(key) ?? deserialize(localStorage.getItem(key));
      try {
        if (!p) p = await initialProject(next, project.fontSize);
      } catch (e) {
        setMessage((e as Error).message);
        return;
      }
      contextRef.current = next;
      setContext(next);
      setProject(p);
      setResult(null);
      setInterp(null);
      setInputReplay(null);
      setMessage(null);
      setIoRun(null);
      setIoFile("");
      setPhase("idle");
    },
    [project],
  );
  const resetToOriginal = () =>
    setConfirm({
      title: "Reset to the original example?",
      body: "Your changes to this file are replaced. Your own project is not affected.",
      action: "Reset",
      danger: true,
      onConfirm: async () => {
        const fresh = await initialProject(context, project.fontSize);
        buffers.current.delete(keyFor(context));
        setProject(save(fresh));
      },
    });



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

  /* ---------------- Execution ---------------- */

  const execute = useCallback(
    async (mode: "compile" | "run" | "trace", override?: { stdin?: string; mainClass?: string | null }): Promise<ExecResult | null> => {
      if (job.current) return null;
      const abort = new AbortController();
      job.current = { id: null, abort };
      setPhase("preparing");
      setMessage(null);
      setResult(null);
      if (mode === "trace") {
        setInterp(null);
      setInputReplay(null);
        setPlaying(false);
      }
      try {
        const files = project.files.map((f) => ({ path: f.path, content: f.content }));
        const started = await startExecution({
          mode,
          files,
          mainClass: override && override.mainClass !== undefined ? override.mainClass : project.mainClass,
          stdin: override?.stdin ?? project.stdin,
        });
        job.current.id = started.id;
        setPhase(started.status);
        const done = await waitForExecution(started.id, (s) => setPhase(s), abort.signal);
        const r = done.result!;
        setResult(r);
        setPhase(r.status);
        if (r.error) setMessage(r.errorCode === "choose_main" ? "More than one class has a main method. Pick the entry point in the toolbar." : r.error);
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
    [project, layout],
  );

  /* Expected Output & Given Inputs: run the current (unsaved) code with the given input. */
  const javaFiles = project.files.filter((f) => f.path.endsWith(".java")).map((f) => f.path);
  const ioPath = ioFile && javaFiles.includes(ioFile) ? ioFile : project.active && project.active.endsWith(".java") ? project.active : javaFiles[0] ?? "";
  const ioSource = project.files.find((f) => f.path === ioPath)?.content ?? "";
  const runIo = async () => {
    if (!ioPath || job.current) return;
    setIoRunning(true);
    const input = ioInput;
    const source = ioSource;
    const r = await execute("run", { stdin: input, mainClass: classFor(ioPath, source) });
    if (r) setIoRun({ result: r, input, file: ioPath, source });
    setIoRunning(false);
  };
  const openIo = () => {
    setRightTab("io");
    if (layout === "code") setLayout("split");
  };

  /* What the code writer sees: the open file, any selection, and real run results only. */
  const diagnosticsText = (r: ExecResult | null | undefined) => (r?.diagnostics ?? []).map((d) => `${d.file}:${d.line}: ${d.message}`).join("\n") || undefined;
  const assistContext = (mode: AssistMode): AssistContext => {
    const usesIo = mode === "explain_output" || mode === "compare_output";
    const filePath = usesIo && ioPath ? ioPath : project.active;
    const f = project.files.find((x) => x.path === filePath);
    const r = usesIo ? ioRun?.result ?? null : result;
    return {
      file: f ? { path: f.path, content: f.content } : undefined,
      selection: !usesIo && selection.current.trim() ? selection.current : undefined,
      input: usesIo ? ioRun?.input ?? (ioInput || undefined) : project.stdin || undefined,
      expectedOutput: ioExpected.trim() ? ioExpected : undefined,
      context: ioContext.trim() ? ioContext : undefined,
      execution: r && r.status !== "queued"
        ? { status: r.status, stdout: r.stdout, stderr: r.stderr, exitCode: typeof r.exitCode === "number" ? r.exitCode : null, diagnostics: diagnosticsText(r) }
        : undefined,
    };
  };
  const applySuggestion = (path: string, code: string) =>
    setProject((p) => ({ ...p, files: p.files.map((f) => (f.path === path ? { ...f, content: code } : f)), active: path, open: p.open.includes(path) ? p.open : [...p.open, path] }));

  /* Stop asks the runner to kill the real process tree; polling then reports "cancelled". */
  const stop = useCallback(async () => {
    const j = job.current;
    if (!j) return;
    if (j.id) await cancelExecution(j.id).catch(() => j.abort.abort());
    else j.abort.abort();
  }, []);

  /* ---------------- Playback ---------------- */

  const steps = interp?.steps ?? [];
  const current = steps[step] ?? null;
  const atEnd = step >= steps.length - 1;
  useEffect(() => {
    if (!playing || atEnd) return;
    const t = setTimeout(() => setStep((s) => Math.min(s + 1, steps.length - 1)), 700 / speed);
    return () => clearTimeout(t);
  }, [playing, step, speed, steps.length, atEnd]);

  /* Follow the execution into whichever file it is in. */
  const currentFile = current?.file ?? null;
  useEffect(() => {
    if (!currentFile) return;
    setProject((p) => (p.files.some((f) => f.path === currentFile) && p.active !== currentFile ? openFile(p, currentFile) : p));
  }, [currentFile]);

  /* ---------------- Editor markers ---------------- */

  const diagnostics: Diagnostic[] = useMemo(() => {
    const list = [...(result?.diagnostics ?? [])];
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
  const stdout = interp && current && result?.stdout !== undefined ? result.stdout.slice(0, current.out) : (result?.stdout ?? "");

  /* ---------------- File actions ---------------- */

  const onChange = useCallback((path: string, value: string) => setProject((p) => setContent(p, path, value)), []);
  const createFile = (path: string) => {
    const err = validatePath(path, project.files.map((f) => f.path));
    if (err) return err;
    setProject((p) => addFile(p, path, newClassSource(path)));
    return null;
  };
  const rename = (from: string, to: string) => {
    if (from === to) return null;
    const err = validatePath(to, project.files.map((f) => f.path), from);
    if (err) return err;
    setProject((p) => renameFile(p, from, to));
    return null;
  };
  const remove = (path: string) =>
    setConfirm({
      title: `Delete ${path}?`,
      body: "This removes the file from your project, including any unsaved changes in it.",
      action: "Delete",
      danger: true,
      onConfirm: () => setProject((p) => save(deleteFile(p, path))),
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
  const importFiles = (files: { path: string; content: string }[]) => {
    setProject((p) => {
      let next = p;
      for (const f of files) next = addFile(next, f.path, f.content);
      return save(openFile(next, files[0].path));
    });
    setImporting(false);
  };
  const jump = (file: string) => setProject((p) => openFile(p, file));

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
  const rightPct = layout === "visualize" ? 0.66 : rightWidth;

  return (
    <div className="flex h-svh flex-col bg-black text-zinc-100 antialiased">
      <style>{`
        @keyframes cv-line-in { from { background-color: rgba(111,233,255,0.22); } }
        @keyframes cv-progress { from { transform: translateX(-100%); } to { transform: translateX(300%); } }
      `}</style>

      <header className="relative flex h-13 shrink-0 items-center gap-2 border-b border-white/10 px-3">
        <Link href="/" className="flex items-center gap-1.5 rounded-full py-1.5 pl-2 pr-3 text-[15px] font-bold tracking-tight transition hover:bg-white/10">
          <BackIcon className="text-zinc-500" />
          codeviz
        </Link>
        <button onClick={() => setExplorer((x) => !x)} className={`${btn} hidden text-zinc-400 hover:bg-white/10 hover:text-zinc-100 md:inline-flex`} aria-pressed={explorer}>
          Files
        </button>
        <button onClick={() => setImporting(true)} className={`${btn} text-zinc-400 hover:bg-white/10 hover:text-zinc-100`}>
          Import
        </button>
        <button onClick={openIo} className={`${btn} hidden text-zinc-400 hover:bg-white/10 hover:text-zinc-100 xl:inline-flex`}>Expected Output &amp; Given Inputs</button>
        <span className="mx-1 hidden h-5 w-px bg-white/10 md:block" aria-hidden="true" />
        <span className="hidden max-w-56 truncate text-[13px] text-zinc-300 lg:inline">
          {context.kind === "project" ? "My project" : exampleById(context.id)?.title}
        </span>
        {context.kind !== "project" && (
          <>
            <button onClick={resetToOriginal} className={`${btn} text-zinc-500 hover:bg-white/10 hover:text-zinc-200`}>Reset</button>
            <button onClick={() => openContext({ kind: "project" })} className={`${btn} hidden text-zinc-500 hover:bg-white/10 hover:text-zinc-200 xl:inline-flex`}>Back to my project</button>
          </>
        )}
        <span className="mx-1 hidden h-5 w-px bg-white/10 md:block" aria-hidden="true" />
        <span
          className="hidden items-center gap-2 text-[12px] text-zinc-500 md:flex"
          title={runtimeError ?? (sandbox === "unavailable" ? runtime?.docker?.problem ?? "Docker is not available." : sandbox === "partial" ? "This runner cannot isolate network access on its host." : sandbox === "docker" ? "Each run uses its own locked-down container." : "Programs run in isolated, resource-limited JVMs.")}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${!runtime || sandbox === "unavailable" ? "bg-[#ff5d73]" : sandbox === "partial" ? "bg-[#f2c94c]" : "bg-[#5fd9c0]"}`} />
          {!runtime
            ? "Runner offline"
            : sandbox === "unavailable"
              ? "Docker unavailable"
              : `Java ${runtime.javaVersion.split("+")[0]}, ${sandbox === "docker" ? "Docker sandbox" : sandbox === "partial" ? "partial sandbox" : "sandboxed"}`}
        </span>
        <div className="flex-1" />

        {mains.length > 1 && (
          <select
            value={project.mainClass ?? ""}
            onChange={(e) => setProject((p) => ({ ...p, mainClass: e.target.value || null }))}
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
        {explorer && (
          <aside className="hidden w-64 shrink-0 flex-col border-r border-white/10 md:flex">
            <div className="flex shrink-0 gap-0.5 border-b border-white/10 px-2 pt-2" role="tablist" aria-label="Sidebar">
              {(["files", "examples"] as const).map((t) => (
                <button key={t} role="tab" aria-selected={sideTab === t} onClick={() => setSideTab(t)} className={`relative px-2.5 pb-2 pt-1 text-[12px] capitalize transition ${sideTab === t ? "text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}>
                  {t}
                  {sideTab === t && <span className="absolute inset-x-2 bottom-0 h-px bg-[#6fe9ff]" />}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {sideTab === "files" ? (
                <FileExplorer project={project} onOpen={(p) => setProject((x) => openFile(x, p))} onCreate={createFile} onRename={rename} onDelete={remove} />
              ) : (
                <div className="pt-2">
                  <LibraryPanel activeId={context.kind === "example" ? context.id : null} onOpenExample={(id) => openContext({ kind: "example", id })} />
                </div>
              )}
            </div>
          </aside>
        )}

        <div className={`flex min-w-0 flex-1 flex-col ${layout === "visualize" ? "max-lg:hidden" : ""}`}>
          <div className="flex h-10 shrink-0 items-end gap-0.5 overflow-x-auto border-b border-white/10 px-2">
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
                  onSelection={(t) => (selection.current = t)} />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-zinc-500">
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
              stdin={project.stdin}
              setStdin={(v) => setProject((p) => ({ ...p, stdin: v }))}
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
              <div className="flex shrink-0 gap-0.5 border-b border-white/10 px-3 pt-2" role="tablist" aria-label="Right panel">
                {([["visualize", "Visualize"], ["io", "Expected Output & Given Inputs"]] as const).map(([t, label]) => (
                  <button key={t} role="tab" aria-selected={rightTab === t} onClick={() => setRightTab(t)} className={`relative px-2.5 pb-2 pt-1 text-[12px] transition ${rightTab === t ? "text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}>
                    {label}
                    {rightTab === t && <span className="absolute inset-x-2 bottom-0 h-px bg-[#6fe9ff]" />}
                  </button>
                ))}
              </div>
              {rightTab === "io" ? (
                <div className="min-h-0 flex-1">
                  <IoAssistant
                    files={javaFiles}
                    file={ioPath}
                    onFile={setIoFile}
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
                {interp && interp.layers.length >= 2 ? (
                  <StructureVisualizer views={current?.layers ?? []} resetKey={resetKey} fontFamily={monoFont} className="absolute inset-0" />
                ) : interp?.structure ? (
                  <StructureVisualizer view={current?.structure ?? null} resetKey={resetKey} fontFamily={monoFont} className="absolute inset-0" />
                ) : interp?.array ? (
                  <TraceVisualizer length={interp.array.length} view={current?.array ?? null} resetKey={resetKey} fontFamily={monoFont} className="absolute inset-0" />
                ) : inputReplay ? (
                  <InputStream replay={inputReplay} step={step} onSeek={(s) => { setPlaying(false); setStep(s); }} fontFamily={monoFont} />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center px-8 text-center">
                    <p className="text-lg font-semibold tracking-tight text-zinc-200">{interp ? "Nothing to draw in this run" : "Watch your code run"}</p>
                    <p className="mt-2 max-w-sm text-sm leading-relaxed text-zinc-500">
                      {interp
                        ? "This program has no array, list, tree, graph, or map to draw. Line-by-line playback, the call stack, variables, and output still work below."
                        : "Visualize records your program's real execution, line by line, and draws the arrays, lists, trees, graphs, and maps it builds. Open an example to try it."}
                    </p>
                    {!interp && (
                      <button onClick={() => execute("trace")} disabled={busy} className="mt-5 rounded-full border border-[#6fe9ff]/35 px-4 py-1.5 text-sm text-[#9ee8ff] hover:bg-[#6fe9ff]/10 disabled:opacity-40">
                        Visualize
                      </button>
                    )}
                  </div>
                )}
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

              {interp && (
                <div className="shrink-0 border-t border-white/10 px-4 py-3">
                  <div className="flex items-center gap-1">
                    <button onClick={() => { setPlaying(false); setStep((s) => Math.max(0, s - 1)); }} className={iconBtn} aria-label="Previous step"><PrevIcon /></button>
                    <button
                      onClick={() => {
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
                    <button onClick={() => { setPlaying(false); setStep((s) => Math.min(steps.length - 1, s + 1)); }} className={iconBtn} aria-label="Next step"><NextIcon /></button>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(steps.length - 1, 0)}
                      value={step}
                      onChange={(e) => { setPlaying(false); setStep(Number(e.target.value)); }}
                      className="mx-2 h-1 min-w-0 flex-1 accent-[#6fe9ff]"
                      aria-label="Recorded step"
                    />
                    <span className="w-24 text-right text-[12px] tabular-nums text-zinc-500">{step + 1} / {steps.length}</span>
                    <button onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])} className="ml-1 w-11 rounded-full border border-white/15 py-0.5 text-[12px] tabular-nums text-zinc-400 hover:text-zinc-100">{speed}×</button>
                  </div>
                  {current && (
                    <div className="mt-2 grid gap-1 text-[13px]">
                      <p className="text-[15px] text-zinc-100" aria-live="polite">{current.note}</p>
                      <p className="truncate text-zinc-500" style={{ fontFamily: monoFont }}>
                        {current.frames.map((f) => `${f.method}():${f.line}`).join("  ‹  ")}
                      </p>
                      {current.vars.length > 0 && (
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
              )}
              </>
              )}
            </section>
          </>
        )}
      </div>

      {importing && <ImportDialog existing={project.files.map((f) => f.path)} onImport={importFiles} onClose={() => setImporting(false)} />}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="alertdialog" aria-modal="true" aria-label={confirm.title}>
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#05070b] p-6">
            <h2 className="text-lg font-semibold text-zinc-50">{confirm.title}</h2>
            <p className="mt-2 text-sm text-zinc-400">{confirm.body}</p>
            <div className="mt-6 flex justify-end gap-2">
              <button autoFocus onClick={() => setConfirm(null)} className="rounded-full px-4 py-2 text-sm text-zinc-400 hover:text-zinc-100">Cancel</button>
              <button
                onClick={() => {
                  confirm.onConfirm();
                  setConfirm(null);
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
        request={assistRequest}
        fontFamily={monoFont}
      />
    </div>
  );
}
