"use client";

import { Fragment, useMemo } from "react";
import { typeName, type InputOp, type InputReplay } from "@/lib/trace/input";

type Props = { replay: InputReplay; step: number; onSeek: (step: number) => void; fontFamily: string; compact?: boolean };

/** Whitespace drawn visibly, so spaces and line breaks never silently disappear. */
const glyph = (ch: string) => (ch === " " ? "·" : ch === "\t" ? "→" : ch === "\r" ? "␍" : ch);
const KIND: Record<InputOp["kind"], string> = {
  line: "Reads a line",
  token: "Reads one token",
  peek: "Checks what comes next, without consuming it",
  tokenizer: "Splits a string into tokens",
  split: "Takes the next token",
  parse: "Converts text to a number",
  config: "Changes how tokens are separated",
};
const LARGE = 4000;

function Visible({ text, className }: { text: string; className?: string }) {
  return (
    <span className={className}>
      {[...text].map((ch, i) => (ch === "\n" ? <span key={i} className="text-zinc-600">↵</span> : /[ \t\r]/.test(ch) ? <span key={i} className="text-zinc-600">{glyph(ch)}</span> : <Fragment key={i}>{ch}</Fragment>))}
    </span>
  );
}

export function InputStream({ replay, step, onSeek, fontFamily, compact }: Props) {
  const { stdin, ops } = replay;
  const now = ops.filter((o) => o.step === step);
  const shown = ops.filter((o) => o.step <= step);
  const focus = now.length ? now : shown.slice(-1);
  const cursor = [...shown].reverse().find((o) => o.cursorAfter !== null)?.cursorAfter ?? 0;
  const lost = shown.some((o) => !o.verified);
  const atEnd = cursor >= stdin.length;

  /* Per-character state: consumed earlier, read now, peeked, failed, or still unread. */
  const marks = useMemo(() => {
    const m = new Map<number, "now" | "peek" | "error">();
    for (const o of now) if (o.range) for (let i = o.range[0]; i < o.range[1]; i++) m.set(i, !o.ok ? "error" : o.kind === "peek" ? "peek" : "now");
    return m;
  }, [now]);
  const charClass = (i: number) => {
    const m = marks.get(i);
    if (m === "error") return "bg-[#ff5d73]/25 text-[#ffb3be] rounded-sm";
    if (m === "now") return "bg-[#6fe9ff]/20 text-[#d9f8ff] rounded-sm";
    if (m === "peek") return "outline outline-1 outline-[#6fe9ff]/50 text-zinc-100 rounded-sm";
    return i < cursor ? "text-zinc-600" : "text-zinc-100";
  };
  const lines = stdin.split("\n");
  let offset = 0;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden px-5 py-4" style={{ fontFamily: undefined }}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-semibold tracking-tight text-zinc-50">Input</h3>
        <p className="text-[11.5px] text-zinc-500">
          Recorded playback of {ops.length} input operation{ops.length === 1 ? "" : "s"} from the real run{replay.truncated ? " (more were not recorded)" : ""}
        </p>
      </div>

      <div className={`mt-3 overflow-auto rounded-lg border border-white/10 bg-[#05070b] px-3 py-2.5 text-[13.5px] leading-[1.7] ${compact ? "max-h-28" : "max-h-48"}`} style={{ fontFamily }} aria-label="Input stream">
        {stdin.length === 0 ? (
          <span className="text-zinc-600">No input was given to this run.</span>
        ) : stdin.length > LARGE ? (
          lines.map((l, li) => {
            const start = offset;
            offset += l.length + 1;
            const state = offset <= cursor ? "text-zinc-600" : start <= cursor && cursor < offset ? "text-[#d9f8ff] bg-[#6fe9ff]/10" : "text-zinc-200";
            return <div key={li} className={`whitespace-pre ${state}`}><span className="mr-3 select-none text-zinc-700">{li + 1}</span>{l || " "}</div>;
          })
        ) : (
          <>
            {lines.map((l, li) => {
              const start = offset;
              offset += l.length + 1;
              const hasBreak = li < lines.length - 1;
              if (!hasBreak && l === "") return null;
              return (
                <div key={li} className="whitespace-pre">
                  <span className="mr-3 inline-block w-5 select-none text-right text-zinc-700">{li + 1}</span>
                  {[...l].map((ch, k) => {
                    const i = start + k;
                    return <span key={k} className={`${charClass(i)} ${i === cursor ? "border-l-2 border-[#6fe9ff]" : ""}`}>{/[ \t\r]/.test(ch) ? <span className="opacity-60">{glyph(ch)}</span> : ch}</span>;
                  })}
                  {hasBreak && <span className={`${charClass(start + l.length)} ${start + l.length === cursor ? "border-l-2 border-[#6fe9ff]" : ""} opacity-70`}>↵</span>}
                </div>
              );
            })}
            <span className={`mt-1 inline-block rounded px-1.5 text-[11px] ${atEnd ? "border-l-2 border-[#6fe9ff] bg-white/10 text-zinc-200" : "text-zinc-600"}`}>end of input</span>
          </>
        )}
      </div>
      <p className="mt-1.5 text-[11px] text-zinc-600">
        Dim text has been read; lit text is being read now; · is a space and ↵ a line break.{lost ? " Some positions are unavailable for this run, so only the real values are shown for those calls." : ""}
      </p>

      <div className="mt-3 min-h-0 flex-1 overflow-auto">
        {focus.map((o) => {
          const source = o.from !== null ? ops.find((x) => x.seq === o.from) : null;
          const raw = o.tokenizer?.range ? o.tokenizer.text.slice(o.tokenizer.range[0], o.tokenizer.range[1]) : o.range && o.kind !== "peek" ? stdin.slice(o.range[0], o.range[1]) : null;
          return (
            <div key={o.seq} className={`mb-2.5 rounded-xl border p-3 ${o.ok ? "border-white/10 bg-white/[0.02]" : "border-[#ff5d73]/30 bg-[#ff5d73]/[0.05]"} ${now.includes(o) ? "" : "opacity-70"}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <code className="text-[13.5px] text-[#cfe9ff]" style={{ fontFamily }}>{o.label}</code>
                <span className="text-[11.5px] text-zinc-500">{KIND[o.kind]} · line {o.line}</span>
              </div>
              {/* Input -> read -> token or line -> conversion -> variable */}
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[12.5px]" style={{ fontFamily }}>
                {o.kind === "parse" ? (
                  <span className="rounded-md border border-white/10 px-2 py-0.5 text-zinc-200">
                    text {JSON.stringify(o.args[0])}{source ? <span className="text-zinc-500"> from {source.label}</span> : null}
                  </span>
                ) : o.kind === "split" || o.kind === "tokenizer" ? (
                  <span className="rounded-md border border-white/10 px-2 py-0.5 text-zinc-300">
                    {[...(o.tokenizer?.text ?? "")].map((ch, i) => {
                      const r = o.tokenizer?.range;
                      return <span key={i} className={r && i >= r[0] && i < r[1] ? "rounded-sm bg-[#6fe9ff]/20 text-[#d9f8ff]" : ""}>{ch === " " ? "·" : ch}</span>;
                    })}
                  </span>
                ) : raw !== null ? (
                  <span className="rounded-md border border-white/10 px-2 py-0.5 text-zinc-200">read <Visible text={raw} /></span>
                ) : null}
                {o.kind !== "config" && o.kind !== "tokenizer" && <span className="text-zinc-600">→</span>}
                {o.ok && o.kind !== "config" && o.kind !== "tokenizer" && (
                  <span className={`rounded-md px-2 py-0.5 ${o.kind === "parse" ? "bg-[#8f6bff]/20 text-[#e3d9ff]" : "bg-[#2f6bff]/20 text-[#dbe6ff]"}`}>
                    {o.result === null ? "null" : o.type === "java.lang.String" ? JSON.stringify(o.result) : o.result} <span className="text-[11px] opacity-70">{typeName(o.type)}</span>
                  </span>
                )}
                {!o.ok && <span className="rounded-md bg-[#ff5d73]/20 px-2 py-0.5 text-[#ffb3be]">{o.error?.type.split(".").pop() ?? "Didn't finish"}{o.error?.message ? `: ${o.error.message}` : ""}</span>}
                {o.ok && o.variable && (
                  <>
                    <span className="text-zinc-600">→</span>
                    <span className="rounded-md border border-[#5fd9c0]/40 px-2 py-0.5 text-[#bff3e7]">{o.variable} <span className="text-[10.5px] text-zinc-500">from the source line</span></span>
                  </>
                )}
              </div>
              {o.note && <p className="mt-2 text-[12.5px] leading-relaxed text-zinc-300">{o.note}</p>}
              {!o.verified && <p className="mt-2 text-[12px] text-[#f2c94c]">Where this call read from isn&apos;t available here. The value shown is the real result from the run.</p>}
            </div>
          );
        })}
        {!focus.length && <p className="text-[13px] text-zinc-500">No input has been read yet at this step.</p>}

        <details className="mt-1" open={!compact}>
          <summary className="cursor-pointer text-[12px] text-zinc-500 hover:text-zinc-300">Every input operation, in order</summary>
          <ol className="mt-1.5 space-y-0.5 text-[12px]" style={{ fontFamily }}>
            {ops.slice(0, 300).map((o) => (
              <li key={o.seq}>
                <button onClick={() => onSeek(o.step)} className={`w-full rounded px-2 py-0.5 text-left transition hover:bg-white/5 ${o.step === step ? "bg-[#2f6bff]/15 text-zinc-100" : o.step < step ? "text-zinc-400" : "text-zinc-600"}`}>
                  {o.seq + 1}. {o.label} {o.ok ? (o.kind === "tokenizer" || o.kind === "config" ? "" : `→ ${o.result === null ? "null" : o.type === "java.lang.String" ? JSON.stringify(o.result) : o.result}`) : <span className="text-[#ff8a9a]">✕ {o.error?.type.split(".").pop()}</span>}
                </button>
              </li>
            ))}
            {ops.length > 300 && <li className="px-2 text-zinc-600">{ops.length - 300} more not listed</li>}
          </ol>
        </details>
      </div>
    </div>
  );
}
