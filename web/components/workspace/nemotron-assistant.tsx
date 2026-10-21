"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { lineDiff } from "@/lib/workspace/diff";
import { PROFILES, type AiLanguage } from "@/lib/ai/languages";

export type AssistMode =
  | "explain_code" | "find_bug" | "implement_method" | "suggest_fix" | "explain_compiler_error" | "predict_behavior"
  | "explain_output" | "compare_output" | "generate_test_input" | "suggest_edge_cases" | "explain_complexity" | "ask"
  | "complete_todo" | "refactor" | "generate_tests" | "explain_algorithm";
export type AssistContext = {
  /** The validated language the request is about; the server refuses to guess it. */
  language?: AiLanguage;
  targetLanguage?: AiLanguage;
  files?: { path: string; content: string }[];
  runtime?: string;
  file?: { path: string; content: string };
  selection?: string;
  input?: string;
  expectedOutput?: string;
  execution?: { status: string; stdout?: string; stderr?: string; exitCode?: number | null; diagnostics?: string };
  context?: string;
};
type Message = {
  role: "user" | "assistant";
  text: string;
  error?: boolean;
  suggestion?: { code: string; path: string } | null;
  applied?: { previous: string | null } | null;
  /* The real compiler's verdict on the suggestion, and how many fix attempts this chain has used. */
  check?: { state: "checking" | "ok" | "failed" | "unavailable"; text?: string; tool?: string } | null;
  attempt?: number;
  language?: AiLanguage;
  /** Stable identity, so a check that finishes later updates the right message. */
  id?: number;
  reviewing?: boolean;
};

const ACTIONS: [AssistMode, string][] = [
  ["complete_todo", "Complete the TODO"],
  ["explain_code", "Explain this code"],
  ["find_bug", "Find the bug"],
  ["implement_method", "Help implement this method"],
  ["suggest_fix", "Suggest a fix"],
  ["explain_compiler_error", "Explain the compiler error"],
  ["predict_behavior", "Predict what this code should do"],
  ["explain_output", "Explain the actual output"],
  ["compare_output", "Compare actual and expected output"],
  ["generate_test_input", "Generate a test input"],
  ["suggest_edge_cases", "Suggest edge cases"],
  ["explain_complexity", "Explain the time complexity"],
  ["refactor", "Improve or refactor"],
  ["generate_tests", "Generate tests"],
  ["explain_algorithm", "Explain the algorithm step by step"],
];
/** Automatic correction attempts after a failed check, to keep retries (and API cost) bounded. */
const MAX_FIX_ATTEMPTS = 2;
export type CheckResult = { ok: boolean; text: string; tool: string; unavailable?: boolean };
const LABEL = Object.fromEntries(ACTIONS) as Record<AssistMode, string>;

type Props = {
  getContext: (mode: AssistMode) => AssistContext;
  getFile: (path: string) => string | null;
  onApply: (path: string, code: string) => void;
  /** Removes a file the assistant created (undoing an applied new file, such as a translation). */
  onDiscard: (path: string) => void;
  /** Compiles or syntax-checks a suggestion in the sandbox, with the rest of the project as it is. */
  onCheck: (path: string, code: string) => Promise<CheckResult>;
  /** The file and language requests will be about, shown before anything is sent. */
  target: { path: string | null; language: AiLanguage | null };
  request: { mode: AssistMode; nonce: number } | null;
  fontFamily: string;
};

/** Small, safe renderer for the subset of Markdown the model uses: code fences, inline code, bold, lists. */
function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("`") && part.endsWith("`") ? <code key={i} className="rounded bg-white/10 px-1 text-[0.92em] text-[#cfe9ff]">{part.slice(1, -1)}</code>
    : part.startsWith("**") && part.endsWith("**") ? <strong key={i} className="font-semibold text-zinc-50">{part.slice(2, -2)}</strong>
    : <Fragment key={i}>{part}</Fragment>,
  );
}
function Rich({ text, fontFamily }: { text: string; fontFamily: string }) {
  const chunks = text.split(/```[\w-]*\n?([\s\S]*?)```/g);
  return (
    <>
      {chunks.map((chunk, i) =>
        i % 2 === 1 ? (
          <pre key={i} className="my-2 max-h-72 overflow-auto rounded-lg border border-white/10 bg-[#05070b] p-3 text-[12px] leading-relaxed text-zinc-100" style={{ fontFamily }}>{chunk.replace(/\s+$/, "")}</pre>
        ) : (
          chunk.split(/\n{2,}/).filter((b) => b.trim()).map((b, j) => {
            const lines = b.split("\n");
            if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l)))
              return <ul key={`${i}-${j}`} className="my-1.5 list-disc space-y-0.5 pl-5">{lines.map((l, k) => <li key={k}>{inline(l.replace(/^\s*([-*]|\d+\.)\s+/, ""))}</li>)}</ul>;
            return <p key={`${i}-${j}`} className="my-1.5">{lines.map((l, k) => <Fragment key={k}>{k > 0 && <br />}{inline(l.replace(/^#+\s*/, ""))}</Fragment>)}</p>;
          })
        ),
      )}
    </>
  );
}

export function NemotronAssistant({ getContext, getFile, onApply, onDiscard, onCheck, target, request, fontFamily }: Props) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<{ configured: boolean; model: string } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const inflight = useRef<AbortController | null>(null);
  const ids = useRef(0);
  const handled = useRef(0);

  useEffect(() => {
    if (!open || status) return;
    fetch("/api/ai/status", { cache: "no-store" }).then((r) => r.json()).then(setStatus).catch(() => setStatus({ configured: false, model: "" }));
  }, [open, status]);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const update = (i: number, patch: Partial<Message>) => setMessages((m) => m.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  /* The real compiler (or Python's own syntax check) looks at every suggestion before it is applied. */
  const updateById = (id: number, patch: Partial<Message>) => setMessages((m) => m.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const verify = async (id: number, path: string, code: string) => {
    updateById(id, { check: { state: "checking" } });
    try {
      const r = await onCheck(path, code);
      updateById(id, { check: { state: r.unavailable ? "unavailable" : r.ok ? "ok" : "failed", text: r.text, tool: r.tool } });
    } catch {
      updateById(id, { check: { state: "unavailable", text: "The runner could not be reached to check this code." } });
    }
  };

  const send = async (mode: AssistMode, instruction?: string, override?: { file: { path: string; content: string }; attempt: number }) => {
    if (busy) return;
    const ctx = getContext(mode);
    if (!ctx.language) {
      setOpen(true);
      setMessages((m) => [...m, { role: "assistant", text: "Open a Java, Python, C, or C++ file first: the assistant needs to know which language to write.", error: true }]);
      return;
    }
    setOpen(true);
    setBusy(true);
    const controller = new AbortController();
    inflight.current = controller;
    setMessages((m) => [...m, { role: "user", text: instruction || LABEL[mode] }]);
    try {
      const res = await fetch("/api/ai/code-assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, instruction, ...ctx, ...(override ? { file: override.file } : {}) }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) setMessages((m) => [...m, { role: "assistant", text: data?.error?.message ?? `The request failed (HTTP ${res.status}).`, error: true }]);
      else if (!data || typeof data.text !== "string") setMessages((m) => [...m, { role: "assistant", text: "Nemotron's answer could not be read. Nothing was changed; try again.", error: true }]);
      else {
        const id = ++ids.current;
        setMessages((m) => [...m, { id, role: "assistant", text: data.rejected ? `${data.text}\n\n${data.rejected}` : data.text, error: !!data.rejected && !data.suggestion, suggestion: data.suggestion, language: data.language, attempt: override?.attempt ?? 0 }]);
        if (data.suggestion) void verify(id, data.suggestion.path, data.suggestion.code);
      }
    } catch (e) {
      const cancelled = (e as Error).name === "AbortError";
      setMessages((m) => [...m, { role: "assistant", text: cancelled ? "Cancelled. Nothing was changed." : "Couldn't reach the web server. Check that npm run dev is still running.", error: !cancelled }]);
    } finally {
      inflight.current = null;
      setBusy(false);
    }
  };
  const cancel = () => inflight.current?.abort();

  useEffect(() => {
    if (request && request.nonce !== handled.current) {
      handled.current = request.nonce;
      void send(request.mode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const lang = target.language ? PROFILES[target.language].name : null;

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close the Nemotron code writer" : "Open the Nemotron code writer"}
        aria-expanded={open}
        className="fixed bottom-5 right-5 z-40 grid h-12 w-12 place-items-center rounded-full border border-[#76b900]/60 bg-[#0a0f05] shadow-[0_0_24px_rgba(118,185,0,0.35)] transition hover:shadow-[0_0_32px_rgba(118,185,0,0.55)] motion-safe:hover:scale-105"
        title="Nemotron code writer"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
          <rect x="4" y="6" width="16" height="12" rx="4" fill="none" stroke="#76b900" strokeWidth="1.6" />
          <circle cx="9.5" cy="12" r="1.6" fill="#a6e22e" />
          <circle cx="14.5" cy="12" r="1.6" fill="#a6e22e" />
          <path d="M12 3v3" stroke="#76b900" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <section
          className="fixed bottom-20 right-5 z-40 flex h-[min(72vh,680px)] w-[440px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#07090c]/95 shadow-2xl backdrop-blur"
          aria-label="Nemotron code writer"
        >
          <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div>
              <p className="flex items-center gap-2 text-[14px] font-semibold text-zinc-50">
                <span className="h-2 w-2 rounded-full bg-[#76b900] shadow-[0_0_8px_#76b900]" />Nemotron code writer
              </p>
              <p className="mt-0.5 text-[11px] text-zinc-500">{status ? (status.configured ? status.model : "Not configured yet") : "Checking…"}</p>
              <p className="mt-0.5 text-[11px] text-zinc-400" aria-live="polite">
                {lang && target.path ? <>Writing <b className="text-zinc-200">{lang}</b> for <span style={{ fontFamily }}>{target.path}</span></> : "Open a Java, Python, C, or C++ file to write code for it."}
              </p>
            </div>
            <button onClick={() => setOpen(false)} className="rounded-md px-2 py-1 text-[12px] text-zinc-500 hover:bg-white/10 hover:text-zinc-200">Close</button>
          </header>

          <div ref={scroller} className="min-h-0 flex-1 overflow-auto px-4 py-3 text-[13px] leading-relaxed text-zinc-300">
            {status && !status.configured && (
              <p className="mb-3 rounded-lg border border-[#f2c94c]/30 bg-[#f2c94c]/[0.06] p-3 text-[12.5px] text-[#f2e2a0]">
                Add NVIDIA_NEMOTRON_API_KEY to web/.env.local, then restart the web app. The key stays on the server.
              </p>
            )}
            {messages.length === 0 && (
              <>
                <p className="text-zinc-400">I can read the file you have open, any code you&apos;ve selected, and your latest run. Pick a task or ask a question.</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {ACTIONS.map(([mode, label]) => (
                    <button key={mode} onClick={() => send(mode)} className="rounded-full border border-white/10 px-2.5 py-1 text-[12px] text-zinc-300 transition hover:border-[#76b900]/60 hover:text-zinc-50">{label}</button>
                  ))}
                </div>
              </>
            )}
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "my-3 flex justify-end" : "my-3"}>
                {m.role === "user" ? (
                  <p className="max-w-[85%] rounded-2xl rounded-br-md bg-[#2f6bff]/20 px-3 py-1.5 text-zinc-100">{m.text}</p>
                ) : (
                  <div className={m.error ? "text-[#ff8a9a]" : ""}>
                    <Rich text={m.text} fontFamily={fontFamily} />
                    {m.suggestion && (
                      <div className="mt-2 rounded-xl border border-[#76b900]/30 bg-[#76b900]/[0.05] p-3">
                        <p className="text-[12px] text-zinc-400">{getFile(m.suggestion.path) === null ? "Suggested new file" : "Suggested change to"} {m.suggestion.path}{m.language ? ` (${PROFILES[m.language].name})` : ""}. Nothing changes until you apply it.</p>
                        {m.check && (
                          <div className={`mt-1.5 rounded-lg px-2 py-1 text-[11.5px] ${m.check.state === "ok" ? "bg-[#5fd9c0]/10 text-[#8ff0dc]" : m.check.state === "failed" ? "bg-[#ff5d73]/10 text-[#ff9aa8]" : "bg-white/5 text-zinc-400"}`} role="status">
                            {m.check.state === "checking" ? "Checking it with the real compiler in the sandbox…"
                              : m.check.state === "ok" ? `Checked: it compiles with ${m.check.tool}. (That is not proof it is correct: run it to see.)`
                                : m.check.state === "failed" ? `${m.check.tool} reports errors in the suggestion:` : m.check.text ?? "Could not check it."}
                            {m.check.state === "failed" && <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap" style={{ fontFamily }}>{m.check.text}</pre>}
                            {m.check.state === "failed" && (m.attempt ?? 0) < MAX_FIX_ATTEMPTS && (
                              <button disabled={busy} onClick={() => void send("suggest_fix", `The suggested code does not compile. ${m.check?.tool} reported:\n${m.check?.text}\nFix these errors and give the complete corrected file.`, { file: { path: m.suggestion!.path, content: m.suggestion!.code }, attempt: (m.attempt ?? 0) + 1 })}
                                className="mt-1.5 h-6 rounded-full border border-[#ff9aa8]/40 px-2.5 text-[11px] text-[#ffc0c8] disabled:opacity-40">
                                Ask Nemotron to fix these errors (attempt {(m.attempt ?? 0) + 1} of {MAX_FIX_ATTEMPTS})
                              </button>
                            )}
                            {m.check.state === "failed" && (m.attempt ?? 0) >= MAX_FIX_ATTEMPTS && <p className="mt-1">Still failing after {MAX_FIX_ATTEMPTS} attempts, so the assistant stops here. The errors above are the real ones; they may need a closer look.</p>}
                          </div>
                        )}
                        {m.reviewing && (
                          <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-[#05070b] p-2 text-[11.5px] leading-relaxed" style={{ fontFamily }}>
                            {lineDiff(getFile(m.suggestion.path) ?? "", m.suggestion.code).map((d, k) => (
                              <div key={k} className={d.kind === "add" ? "bg-[#5fd9c0]/10 text-[#8ff0dc]" : d.kind === "del" ? "bg-[#ff5d73]/10 text-[#ff9aa8] line-through decoration-[#ff5d73]/40" : "text-zinc-500"}>
                                {d.kind === "add" ? "+ " : d.kind === "del" ? "- " : "  "}{d.text || " "}
                              </div>
                            ))}
                          </pre>
                        )}
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button onClick={() => update(i, { reviewing: !m.reviewing })} className="h-7 rounded-full border border-white/15 px-3 text-[12px] text-zinc-200 hover:border-white/35">
                            {m.reviewing ? "Hide changes" : "Review changes"}
                          </button>
                          {m.applied ? (
                            <button onClick={() => { if (m.applied!.previous === null) onDiscard(m.suggestion!.path); else onApply(m.suggestion!.path, m.applied!.previous); update(i, { applied: null }); }} className="h-7 rounded-full border border-[#f2c94c]/40 px-3 text-[12px] text-[#f2e2a0]">Undo</button>
                          ) : (
                            <button
                              onClick={() => {
                                const previous = getFile(m.suggestion!.path);
                                onApply(m.suggestion!.path, m.suggestion!.code);
                                update(i, { applied: { previous } });
                              }}
                              className="h-7 rounded-full bg-[#76b900] px-3 text-[12px] font-semibold text-black hover:bg-[#8fd400]"
                            >
                              Apply to editor
                            </button>
                          )}
                        </div>
                        {m.applied && <p className="mt-1.5 text-[11px] text-zinc-500">Applied. It isn&apos;t saved until you save the file, and Undo or Ctrl+Z puts your version back.</p>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {busy && (
              <p className="my-3 flex items-center gap-3 text-zinc-500">
                <span className="motion-safe:animate-pulse">Nemotron is thinking…</span>
                <button onClick={cancel} className="h-6 rounded-full border border-white/15 px-2.5 text-[11px] text-zinc-300 hover:border-white/35">Cancel</button>
              </p>
            )}
          </div>

          {messages.length > 0 && (
            <div className="flex gap-1.5 overflow-x-auto border-t border-white/5 px-3 py-2">
              {ACTIONS.slice(0, 6).map(([mode, label]) => (
                <button key={mode} disabled={busy} onClick={() => send(mode)} className="shrink-0 rounded-full border border-white/10 px-2.5 py-0.5 text-[11px] text-zinc-400 hover:text-zinc-100 disabled:opacity-40">{label}</button>
              ))}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!prompt.trim()) return;
              void send("ask", prompt.trim());
              setPrompt("");
            }}
            className="flex gap-2 border-t border-white/10 p-3"
          >
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ask about this file…"
              className="h-9 min-w-0 flex-1 rounded-full border border-white/10 bg-[#05070b] px-4 text-[13px] text-zinc-100 placeholder:text-zinc-600 focus:border-[#76b900]/60 focus:outline-none"
              aria-label="Ask Nemotron"
            />
            <button disabled={busy || !prompt.trim()} className="h-9 rounded-full bg-zinc-50 px-4 text-[13px] font-semibold text-black disabled:opacity-40">Ask</button>
          </form>
        </section>
      )}
    </>
  );
}
