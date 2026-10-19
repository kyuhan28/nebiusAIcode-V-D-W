"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CodeEditor } from "./code-editor";
import { TreeVisualizer } from "./tree-visualizer";
import { BackIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon } from "./icons";
import { DEMO_TRACE, DEMO_TREE, SAMPLE_CODE, stateAt, type TraceStep } from "@/lib/trace/inorder-demo";
import { STATE_COLORS } from "@/lib/state-colors";

const SPEEDS = [0.5, 1, 2];
const STEP_MS = 900;

const LEGEND = [
  { label: "Not visited", color: STATE_COLORS.idle },
  { label: "On the call stack", color: STATE_COLORS.stack },
  { label: "Current", color: STATE_COLORS.current },
  { label: "Visited", color: STATE_COLORS.visited },
];

const iconButton =
  "inline-flex h-9 w-9 items-center justify-center rounded-full text-zinc-300 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70";

export function Workspace({ monoFont }: { monoFont: string }) {
  const [code, setCode] = useState(SAMPLE_CODE);
  const [steps, setSteps] = useState<TraceStep[] | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);

  const atEnd = steps ? index >= steps.length - 1 : false;
  const isPlaying = playing && !atEnd;
  const step = steps?.[index] ?? null;
  const vizState = useMemo(() => stateAt(steps, index), [steps, index]);

  const run = useCallback(() => {
    setNotice(
      code.trim() === SAMPLE_CODE.trim()
        ? null
        : "Tracing your own code needs the backend, which isn't connected yet. Playing the sample program's run for now.",
    );
    setSteps(DEMO_TRACE);
    setIndex(0);
    setPlaying(true);
  }, [code]);

  const togglePlay = useCallback(() => {
    if (!steps) return run();
    if (atEnd) {
      setIndex(0);
      setPlaying(true);
      return;
    }
    setPlaying((p) => !p);
  }, [steps, atEnd, run]);

  const stepBy = useCallback(
    (delta: number) => {
      setPlaying(false);
      if (!steps) {
        setSteps(DEMO_TRACE);
        setIndex(0);
        return;
      }
      setIndex((i) => Math.min(Math.max(i + delta, 0), steps.length - 1));
    },
    [steps],
  );

  const jumpToNode = useCallback((id: string) => {
    const target = DEMO_TRACE.findIndex((s) => s.event === "visit" && s.nodeId === id);
    if (target < 0) return;
    setSteps(DEMO_TRACE);
    setIndex(target);
    setPlaying(false);
  }, []);

  useEffect(() => {
    if (!isPlaying || !steps) return;
    const timer = setTimeout(() => setIndex((i) => Math.min(i + 1, steps.length - 1)), STEP_MS / speed);
    return () => clearTimeout(timer);
  }, [isPlaying, steps, index, speed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest(".monaco-editor, input, textarea, button, a")) return;
      if (e.key === " ") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowRight") stepBy(1);
      else if (e.key === "ArrowLeft") stepBy(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, stepBy]);

  const stackText = step?.stack.length
    ? step.stack.map((id) => `inorder(${DEMO_TREE[id].value})`).join("  ›  ")
    : "Empty";

  return (
    <div className="flex h-svh flex-col bg-black text-zinc-100 antialiased">
      <style>{`
        .cv-active-line { background: rgba(242, 201, 76, 0.13); }
        .cv-active-gutter { background: #f2c94c; width: 3px !important; margin-left: 4px; }
      `}</style>

      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/10 px-3 sm:px-5">
        <Link
          href="/"
          className="flex items-center gap-1.5 rounded-full py-1.5 pl-2 pr-3 font-bold tracking-tight transition hover:bg-white/10"
        >
          <BackIcon className="text-zinc-400" />
          codeviz
        </Link>
        <span className="rounded-md border border-white/10 px-2.5 py-1 text-xs text-zinc-400">Main.java</span>
        <span className="rounded-md bg-[#7c5cff]/15 px-2.5 py-1 text-xs text-[#b9a7ff]">Java</span>
        <div className="flex-1" />
        <button
          onClick={run}
          className="inline-flex h-9 items-center gap-2 rounded-full bg-zinc-50 px-5 text-sm font-semibold text-black transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
        >
          <PlayIcon />
          Run
        </button>
      </header>

      {notice && (
        <p role="status" className="shrink-0 border-b border-white/10 bg-[#f2c94c]/10 px-5 py-2 text-sm text-[#f2c94c]">
          {notice}
        </p>
      )}

      <main className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1.15fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:grid-rows-1">
        <section aria-label="Code editor" className="flex min-h-0 flex-col border-b border-white/10 lg:border-b-0 lg:border-r">
          <div className="min-h-0 flex-1">
            <CodeEditor value={code} onChange={setCode} activeLine={step?.line ?? null} fontFamily={monoFont} />
          </div>
          <dl className="grid shrink-0 grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 border-t border-white/10 px-5 py-4 text-sm">
            <dt className="text-zinc-500">Output</dt>
            <dd className="truncate text-zinc-100" style={{ fontFamily: monoFont }}>
              {step ? `[${step.output.join(", ")}]` : "Run the program to see output"}
            </dd>
            <dt className="text-zinc-500">Call stack</dt>
            <dd className="truncate text-[#b9a7ff]" style={{ fontFamily: monoFont }}>
              {step ? stackText : "Empty"}
            </dd>
          </dl>
        </section>

        <section aria-label="Visualizer" className="flex min-h-0 flex-col">
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <TreeVisualizer state={vizState} onNodeClick={jumpToNode} resetKey={resetKey} className="absolute inset-0" />

            <ul className="pointer-events-none absolute left-4 top-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-zinc-400">
              {LEGEND.map((item) => (
                <li key={item.label} className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color }} aria-hidden="true" />
                  {item.label}
                </li>
              ))}
            </ul>
            <button
              onClick={() => setResetKey((k) => k + 1)}
              className="absolute right-4 top-4 rounded-full border border-white/15 px-3 py-1.5 text-xs text-zinc-300 transition hover:border-white/40 hover:text-white"
            >
              Reset view
            </button>

            {!steps && (
              <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center px-4">
                <p className="rounded-full border border-white/15 bg-black/70 px-5 py-2.5 text-sm text-zinc-300">
                  Press Run to trace the program, or click a node to jump to its visit
                </p>
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-white/10 px-4 py-3 sm:px-5">
            <div className="flex items-center gap-1 sm:gap-2">
              <button onClick={() => stepBy(-1)} className={iconButton} aria-label="Previous step">
                <PrevIcon />
              </button>
              <button
                onClick={togglePlay}
                className={`${iconButton} bg-white/10`}
                aria-label={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? <PauseIcon /> : <PlayIcon />}
              </button>
              <button onClick={() => stepBy(1)} className={iconButton} aria-label="Next step">
                <NextIcon />
              </button>
              <input
                type="range"
                min={0}
                max={(steps?.length ?? DEMO_TRACE.length) - 1}
                step={1}
                value={index}
                onChange={(e) => {
                  setSteps(DEMO_TRACE);
                  setPlaying(false);
                  setIndex(Number(e.target.value));
                }}
                aria-label="Step"
                className="mx-2 h-1 min-w-0 flex-1 cursor-pointer accent-[#f2c94c]"
              />
              <span className="w-24 shrink-0 text-right text-xs tabular-nums text-zinc-400">
                {steps ? `Step ${index + 1} of ${steps.length}` : "Not started"}
              </span>
              <button
                onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])}
                className="ml-1 w-12 shrink-0 rounded-full border border-white/15 py-1 text-xs tabular-nums text-zinc-300 transition hover:border-white/40"
                aria-label={`Playback speed ${speed}x`}
              >
                {speed}×
              </button>
            </div>

            <ol className="mt-3 space-y-1 text-sm leading-relaxed">
              <li className="truncate text-zinc-600">{steps && index > 0 ? steps[index - 1].note : "\u00a0"}</li>
              <li className="truncate text-base text-zinc-50" aria-live="polite">
                {step ? step.note : "The sample builds a binary search tree, then walks it in order."}
              </li>
              <li className="truncate text-zinc-600">{steps?.[index + 1]?.note ?? "\u00a0"}</li>
            </ol>
          </div>
        </section>
      </main>
    </div>
  );
}
