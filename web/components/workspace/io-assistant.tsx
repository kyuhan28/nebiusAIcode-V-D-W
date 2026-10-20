"use client";

import { useMemo } from "react";
import { COMPARISON_POLICY, compareOutputs } from "@/lib/workspace/compare";
import type { ExecResult } from "@/lib/workspace/runner-client";

export type IoRun = { result: ExecResult; input: string; file: string; source: string };

type Props = {
  files: string[];
  file: string;
  onFile: (path: string) => void;
  input: string;
  onInput: (v: string) => void;
  expected: string;
  onExpected: (v: string) => void;
  context: string;
  onContext: (v: string) => void;
  running: boolean;
  run: IoRun | null;
  currentSource: string;
  onRun: () => void;
  onStop: () => void;
  onExplain: () => void;
  fontFamily: string;
};

const STATUS: Record<string, { text: string; tone: string }> = {
  completed: { text: "Ran successfully", tone: "text-[#5fd9c0]" },
  runtime_error: { text: "Runtime error", tone: "text-[#ff8a9a]" },
  compile_failed: { text: "Didn't compile", tone: "text-[#ff8a9a]" },
  timed_out: { text: "Timed out", tone: "text-[#f2c94c]" },
  cancelled: { text: "Stopped", tone: "text-[#f2c94c]" },
  failed: { text: "Couldn't run", tone: "text-[#ff8a9a]" },
};

const field = "w-full resize-y rounded-lg border border-white/10 bg-[#05070b] px-3 py-2 text-[12.5px] text-zinc-100 placeholder:text-zinc-600 focus:border-[#2f6bff]/60 focus:outline-none";

export function IoAssistant(p: Props) {
  const r = p.run?.result;
  const comparison = useMemo(() => (r && p.expected.trim() !== "" && r.status !== "compile_failed" ? compareOutputs(r.stdout ?? "", p.expected) : null), [r, p.expected]);
  const stale = p.run && (p.run.input !== p.input || p.run.file !== p.file || p.run.source !== p.currentSource);
  const status = r ? STATUS[r.status] ?? { text: r.status, tone: "text-zinc-300" } : null;
  return (
    <div className="h-full overflow-auto px-5 py-5">
      <h2 className="text-[17px] font-semibold tracking-tight text-zinc-50">Expected Output &amp; Given Inputs</h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-400">
        Run your current code with an input to see what it really prints. Add an expected output to compare, or ask Nemotron to explain the result.
      </p>

      <label className="mt-5 block text-[12px] font-medium text-zinc-500" htmlFor="io-file">Java file</label>
      <select id="io-file" value={p.file} onChange={(e) => p.onFile(e.target.value)} className={`${field} mt-1.5 h-9 resize-none py-0`} style={{ fontFamily: p.fontFamily }}>
        {p.files.map((f) => <option key={f} value={f}>{f}</option>)}
      </select>

      <label className="mt-4 block text-[12px] font-medium text-zinc-500" htmlFor="io-input">Given input <span className="font-normal text-zinc-600">(standard input)</span></label>
      <textarea id="io-input" value={p.input} onChange={(e) => p.onInput(e.target.value)} rows={4} placeholder="Leave empty if the program reads nothing" className={`${field} mt-1.5`} style={{ fontFamily: p.fontFamily }} spellCheck={false} />

      <label className="mt-4 block text-[12px] font-medium text-zinc-500" htmlFor="io-expected">Expected output <span className="font-normal text-zinc-600">(optional)</span></label>
      <textarea id="io-expected" value={p.expected} onChange={(e) => p.onExpected(e.target.value)} rows={3} placeholder="From your assignment, if you have it" className={`${field} mt-1.5`} style={{ fontFamily: p.fontFamily }} spellCheck={false} />

      <label className="mt-4 block text-[12px] font-medium text-zinc-500" htmlFor="io-context">Additional context <span className="font-normal text-zinc-600">(optional)</span></label>
      <textarea id="io-context" value={p.context} onChange={(e) => p.onContext(e.target.value)} rows={2} placeholder="What the program should do, or where you're stuck" className={`${field} mt-1.5`} />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {p.running ? (
          <button onClick={p.onStop} className="h-8 rounded-full bg-[#ff5d73] px-4 text-[13px] font-semibold text-black">Stop</button>
        ) : (
          <button onClick={p.onRun} disabled={!p.file} className="h-8 rounded-full bg-zinc-50 px-4 text-[13px] font-semibold text-black transition hover:bg-white disabled:opacity-40">Run with this input</button>
        )}
        <button onClick={p.onExplain} disabled={p.running} className="h-8 rounded-full border border-[#76b900]/50 px-4 text-[13px] text-[#a6e22e] transition hover:border-[#76b900] hover:bg-[#76b900]/10 disabled:opacity-40">
          {r ? (comparison && !comparison.match ? "Ask Nemotron why they differ" : "Ask Nemotron to explain") : "Ask Nemotron"}
        </button>
      </div>

      {r && status && (
        <section className="mt-6" aria-live="polite">
          <div className="flex items-baseline justify-between gap-3">
            <p className={`text-[14px] font-semibold ${status.tone}`}>
              {status.text}
              {typeof r.exitCode === "number" && r.status !== "compile_failed" && <span className="ml-2 text-[12px] font-normal text-zinc-500">exit code {r.exitCode}</span>}
            </p>
            {stale && <span className="text-[11px] text-[#f2c94c]">Inputs or code changed since this run</span>}
          </div>

          {r.status === "compile_failed" ? (
            <div className="mt-3">
              <p className="text-[12px] font-medium text-zinc-500">Compiler errors</p>
              <ul className="mt-1.5 space-y-1 text-[12px]" style={{ fontFamily: p.fontFamily }}>
                {(r.diagnostics ?? []).map((d, i) => <li key={i} className="text-[#ff8a9a]">{d.file}:{d.line} {d.message}</li>)}
              </ul>
            </div>
          ) : (
            <>
              <p className="mt-3 text-[12px] font-medium text-zinc-500">Actual output <span className="font-normal text-zinc-600">(from running your code)</span></p>
              <pre className="mt-1.5 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-[#05070b] p-3 text-[12.5px] text-zinc-100" style={{ fontFamily: p.fontFamily }}>
                {r.stdout || <span className="text-zinc-600">(nothing printed)</span>}
              </pre>
              {r.stderr && (
                <>
                  <p className="mt-3 text-[12px] font-medium text-zinc-500">Errors printed by the program</p>
                  <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-[#ff5d73]/20 bg-[#0b0507] p-3 text-[12px] text-[#ff8a9a]" style={{ fontFamily: p.fontFamily }}>{r.stderr}</pre>
                </>
              )}
            </>
          )}

          {comparison && (
            <div className="mt-5">
              <p className={`text-[14px] font-semibold ${comparison.match ? "text-[#5fd9c0]" : "text-[#ff8a9a]"}`}>
                {comparison.match ? "Matches your expected output" : `Doesn't match your expected output, starting at line ${comparison.firstMismatch}`}
              </p>
              {comparison.note && <p className="mt-1 text-[12.5px] text-zinc-300">{comparison.note}</p>}
              {!comparison.match && (
                <table className="mt-3 w-full table-fixed border-collapse text-[12px]" style={{ fontFamily: p.fontFamily }}>
                  <thead>
                    <tr className="text-left text-zinc-500">
                      <th className="w-10 pb-1 font-normal">Line</th>
                      <th className="pb-1 font-normal">Your expected output</th>
                      <th className="pb-1 font-normal">Actual output</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.lines.slice(0, 200).map((l) => (
                      <tr key={l.line} className={l.same ? "text-zinc-500" : "bg-[#ff5d73]/[0.07]"}>
                        <td className="py-0.5 align-top">{l.line}</td>
                        <td className="whitespace-pre-wrap break-all py-0.5 align-top text-zinc-200">{l.expected === null ? <span className="text-zinc-600">(no line)</span> : l.expected.replace(/ /g, "·")}</td>
                        <td className={`whitespace-pre-wrap break-all py-0.5 align-top ${l.same ? "" : "text-[#ff8a9a]"}`}>{l.actual === null ? <span className="text-zinc-600">(no line)</span> : l.actual.replace(/ /g, "·")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="mt-2 text-[11px] leading-relaxed text-zinc-600">{COMPARISON_POLICY}{!comparison.match ? " Spaces are shown as dots." : ""}</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
