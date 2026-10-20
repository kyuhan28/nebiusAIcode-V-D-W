"use client";

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
  tab: "output" | "problems" | "input";
  setTab: (t: "output" | "problems" | "input") => void;
  phase: Phase;
  result: ExecResult | null;
  message: string | null;
  stdout: string;
  diagnostics: Diagnostic[];
  stdin: string;
  setStdin: (v: string) => void;
  onJump: (file: string, line: number) => void;
  onClear: () => void;
  fontFamily: string;
};

export function TerminalPanel({ tab, setTab, phase, result, message, stdout, diagnostics, stdin, setStdin, onJump, onClear, fontFamily }: Props) {
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const copy = () => navigator.clipboard?.writeText([stdout, result?.stderr ?? ""].filter(Boolean).join("\n"));
  const tabs: { id: "output" | "problems" | "input"; label: string }[] = [
    { id: "output", label: "Output" },
    { id: "problems", label: diagnostics.length ? `Problems ${diagnostics.length}` : "Problems" },
    { id: "input", label: stdin ? "Input •" : "Input" },
  ];
  return (
    <section aria-label="Terminal" className="flex h-full min-h-0 flex-col bg-black">
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
        {result?.javaVersion && <span className="ml-3 hidden text-[12px] text-zinc-600 sm:inline">Java {result.javaVersion.split("+")[0]}</span>}
        <button onClick={copy} className="ml-3 rounded px-2 py-1 text-[12px] text-zinc-500 hover:bg-white/10 hover:text-zinc-200">Copy</button>
        <button onClick={onClear} className="rounded px-2 py-1 text-[12px] text-zinc-500 hover:bg-white/10 hover:text-zinc-200">Clear</button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3 text-[13px] leading-relaxed" style={{ fontFamily }}>
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
            {stdout ? <pre className="whitespace-pre-wrap text-zinc-100">{stdout}</pre> : null}
            {result?.stdoutTruncated && <p className="text-zinc-500">Output was longer than 64 KB and was cut off.</p>}
            {result?.stderr ? <pre className="mt-2 whitespace-pre-wrap text-[#ff8a9a]/90">{result.stderr}</pre> : null}
            {!stdout && !result?.stderr && !message && !result?.exception && (
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
        {tab === "input" && (
          <div className="flex h-full flex-col gap-2">
            <p className="text-zinc-500" style={{ fontFamily: "inherit" }}>
              Text here is sent to the program&apos;s standard input when it starts. Reading past the end ends the input instead of waiting.
            </p>
            <textarea
              value={stdin}
              onChange={(e) => setStdin(e.target.value)}
              placeholder={"5 3\nhello"}
              className="min-h-24 flex-1 resize-none rounded-md border border-white/10 bg-black p-2 text-zinc-100 outline-none focus:border-[#6fe9ff]/50"
              aria-label="Program input"
            />
          </div>
        )}
      </div>
    </section>
  );
}
