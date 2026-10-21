"use client";

import { useEffect, useRef, useState } from "react";
import type { Diagnostic, ExecResult } from "@/lib/workspace/runner-client";

export type Phase = "idle" | "preparing" | "queued" | "compiling" | "running" | "completed" | "compile_failed" | "runtime_error" | "timed_out" | "cancelled" | "failed" | "offline";

export const PHASE_LABEL: Record<Phase, string> = {
  idle: "Idle",
  preparing: "Preparing",
  queued: "Waiting for the runner",
  compiling: "Compiling",
  running: "Running",
  completed: "Completed",
  compile_failed: "Compilation failed",
  runtime_error: "Runtime error",
  timed_out: "Timed out",
  cancelled: "Stopped",
  failed: "Could not run",
  offline: "Runner offline",
};

export const phaseTone = (p: Phase) =>
  p === "completed" ? "text-[#5fd9c0]" : ["compile_failed", "runtime_error", "failed", "offline"].includes(p) ? "text-[#ff8a9a]" : p === "timed_out" || p === "cancelled" ? "text-[#f2c94c]" : "text-[#6fe9ff]";

type Props = {
  tab: "output" | "problems";
  setTab: (t: "output" | "problems") => void;
  phase: Phase;
  result: ExecResult | null;
  message: string | null;
  stdout: string;
  diagnostics: Diagnostic[];
  /** An interactive run: its output so far, whether it reads input, and the lines typed into it. */
  live: { stdout: string; stderr: string; acceptsInput: boolean; echoes: { at: number; text: string }[] } | null;
  onSend: (text: string, eof?: boolean) => void;
  onJump: (file: string, line: number) => void;
  onClear: () => void;
  fontFamily: string;
};

/** The program's output with the lines typed into it, in the order they happened, like a terminal. */
function transcript(out: string, echoes: { at: number; text: string }[]) {
  const parts: { text: string; typed: boolean }[] = [];
  let from = 0;
  for (const e of [...echoes].sort((a, b) => a.at - b.at)) {
    const at = Math.min(Math.max(e.at, from), out.length);
    if (at > from) parts.push({ text: out.slice(from, at), typed: false });
    parts.push({ text: e.text, typed: true });
    from = at;
  }
  if (from < out.length) parts.push({ text: out.slice(from), typed: false });
  return parts;
}

export function TerminalPanel({ tab, setTab, phase, result, message, stdout, diagnostics, live, onSend, onJump, onClear, fontFamily }: Props) {
  const [line, setLine] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  /* While a program runs interactively, its output is the live output; afterwards, the final one. */
  const out = live && !result ? live.stdout : stdout;
  const err = live && !result ? live.stderr : result?.stderr;
  const waiting = !!live?.acceptsInput && !result;
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [out, live?.echoes.length]);
  useEffect(() => {
    if (waiting) inputRef.current?.focus({ preventScroll: true });
  }, [waiting]);
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const copy = () => navigator.clipboard?.writeText([stdout, result?.stderr ?? ""].filter(Boolean).join("\n"));
  const tabs: { id: "output" | "problems"; label: string }[] = [
    { id: "output", label: "Output" },
    { id: "problems", label: diagnostics.length ? `Problems ${diagnostics.length}` : "Problems" },
  ];
  return (
    <section aria-label="Terminal" className="cv-glass-panel flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-white/10 px-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`relative px-3 py-2 text-[12px] transition ${tab === t.id ? "text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
            aria-pressed={tab === t.id}
          >
            {t.label}
            {tab === t.id && <span className="absolute inset-x-3 bottom-0 h-px bg-[#6fe9ff]" />}
          </button>
        ))}
        <div className="flex-1" />
        <span className={`text-[12px] ${phaseTone(phase)}`}>{PHASE_LABEL[phase]}</span>
        {result?.exitCode !== undefined && result.exitCode !== null && <span className="ml-3 text-[12px] text-zinc-500">exit {result.exitCode}</span>}
        {result?.durationMs !== undefined && <span className="ml-3 text-[12px] tabular-nums text-zinc-500">{result.durationMs} ms</span>}
        {/* The runtime of this run's language (a Python result also reports the runner's Java version). */}
        {result && (result.language === "python" ? result.pythonVersion : result.language === "c" || result.language === "cpp" ? result.compiler : result.javaVersion) && (
          <span className="ml-3 hidden text-[12px] text-zinc-600 sm:inline">
            {result.language === "python" ? `Python ${result.pythonVersion}` : result.language === "c" || result.language === "cpp" ? result.compiler : `Java ${result.javaVersion!.split("+")[0]}`}
          </span>
        )}
        <button onClick={copy} className="ml-3 rounded px-2 py-1 text-[12px] text-zinc-500 hover:bg-white/10 hover:text-zinc-200">Copy</button>
        <button onClick={onClear} className="rounded px-2 py-1 text-[12px] text-zinc-500 hover:bg-white/10 hover:text-zinc-200">Clear</button>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-auto px-4 py-3 text-[13px] leading-relaxed" style={{ fontFamily }}>
        {tab === "output" && (
          <>
            {message && <p className="mb-2 text-[#f2c94c]">{message}</p>}
            {result?.exception && (
              <p className="mb-2 text-[#ff8a9a]">
                {result.exception.type}
                {result.exception.message ? `: ${result.exception.message}` : ""}
                {result.exception.line ? ` (line ${result.exception.line})` : ""}
              </p>
            )}
            {out || live?.echoes.length ? (
              <pre className="whitespace-pre-wrap text-zinc-100">
                {transcript(out ?? "", live?.echoes ?? []).map((p, i) => (p.typed ? <span key={i} className="text-[#6fe9ff]">{p.text}</span> : <span key={i}>{p.text}</span>))}
              </pre>
            ) : null}
            {waiting && (
              <form
                className="mt-1 flex items-center gap-2"
                onSubmit={(e) => { e.preventDefault(); onSend(line + "\n"); setLine(""); }}
              >
                <span className="text-[#6fe9ff]" aria-hidden="true">›</span>
                <input
                  ref={inputRef}
                  value={line}
                  onChange={(e) => setLine(e.target.value)}
                  onKeyDown={(e) => { if (e.ctrlKey && (e.key === "d" || e.key === "D")) { e.preventDefault(); onSend(line, true); setLine(""); } }}
                  placeholder="Type input for the program and press Enter"
                  aria-label="Program input"
                  className="min-w-0 flex-1 bg-transparent text-zinc-100 outline-none placeholder:text-zinc-600"
                  style={{ fontFamily }}
                  spellCheck={false}
                  autoComplete="off"
                />
                <button type="button" onClick={() => { onSend(line, true); setLine(""); }} className="rounded-full border border-white/15 px-2.5 py-0.5 text-[11px] text-zinc-400 hover:border-white/35 hover:text-zinc-200" title="Ends the program's input, as Ctrl+D does in a terminal">
                  End input
                </button>
              </form>
            )}
            {result?.stdoutTruncated && <p className="text-zinc-500">Output was longer than 64 KB and was cut off.</p>}
            {err ? <pre className="mt-2 whitespace-pre-wrap text-[#ff8a9a]/90">{err}</pre> : null}
            {!out && !err && !message && !result?.exception && !waiting && (
              <p className="text-zinc-600">
                {phase === "idle" ? "Run your program to see its output here. Ctrl+Enter runs, Ctrl+Shift+Enter visualizes." : phase === "completed" ? "The program finished without printing anything." : ""}
              </p>
            )}
          </>
        )}
        {tab === "problems" &&
          (diagnostics.length === 0 ? (
            <p className="text-zinc-600">{errors === 0 && result ? "No problems found by the compiler." : "Compile to check your code for problems."}</p>
          ) : (
            <ul className="space-y-1">
              {diagnostics.map((d, i) => (
                <li key={i}>
                  <button
                    className="w-full rounded px-2 py-1 text-left hover:bg-white/5"
                    onClick={() => d.file && d.line && onJump(d.file, d.line)}
                  >
                    <span className={d.severity === "error" ? "text-[#ff8a9a]" : "text-[#f2c94c]"}>{d.severity}</span>
                    <span className="text-zinc-500"> {d.file}{d.line ? `:${d.line}` : ""}{d.column ? `:${d.column}` : ""} </span>
                    <span className="text-zinc-200">{d.message.split("\n")[0]}</span>
                  </button>
                </li>
              ))}
            </ul>
          ))}
      </div>
    </section>
  );
}
