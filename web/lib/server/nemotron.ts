/**
 * NVIDIA Nemotron for the code writer. Server-only: the API key is read from the server's
 * environment, never sent to the browser, never logged, and never passed to Java containers.
 *
 * NVIDIA's hosted endpoint is OpenAI-compatible: POST {base}/chat/completions with
 * Authorization: Bearer nvapi-... (see https://build.nvidia.com).
 */
export const ASSIST_MODES = [
  "explain_code", "find_bug", "implement_method", "suggest_fix", "explain_compiler_error", "predict_behavior",
  "explain_output", "compare_output", "generate_test_input", "suggest_edge_cases", "explain_complexity", "ask",
] as const;
export type AssistMode = (typeof ASSIST_MODES)[number];

export type AssistRequest = {
  mode: AssistMode;
  instruction?: string;
  file?: { path: string; content: string };
  selection?: string;
  input?: string;
  expectedOutput?: string;
  /** Present only when the real runtime executed the code. */
  execution?: { status: string; stdout?: string; stderr?: string; exitCode?: number | null; diagnostics?: string };
  context?: string;
};
export type AssistResponse = { text: string; suggestion: { code: string; path: string } | null; model: string };
export type AssistError = { status: number; code: string; message: string };

const LIMITS = { file: 100_000, field: 20_000, instruction: 4_000, total: 160_000 };
/* Modes that may propose a replacement file; explanations never do. */
const CHANGES_CODE = new Set<AssistMode>(["find_bug", "implement_method", "suggest_fix", "explain_compiler_error", "ask"]);

export function config() {
  return {
    key: process.env.NVIDIA_NEMOTRON_API_KEY ?? "",
    model: process.env.NVIDIA_NEMOTRON_MODEL || "nvidia/nemotron-3-super-120b-a12b",
    base: (process.env.NVIDIA_API_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/+$/, ""),
    timeoutMs: Number(process.env.NVIDIA_NEMOTRON_TIMEOUT_MS || 90_000),
  };
}

export function validate(body: unknown): AssistRequest | AssistError {
  const b = body as Partial<AssistRequest> | null;
  const bad = (message: string, status = 400): AssistError => ({ status, code: status === 413 ? "too_large" : "bad_request", message });
  if (!b || typeof b !== "object") return bad("Send a JSON object.");
  if (!ASSIST_MODES.includes(b.mode as AssistMode)) return bad("Unknown assistance mode.");
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  if (b.file && (typeof b.file.path !== "string" || typeof b.file.content !== "string")) return bad("file needs a path and content.");
  if ((b.file?.content.length ?? 0) > LIMITS.file) return bad("The file is too large to send (100 KB limit).", 413);
  if ((str(b.instruction)?.length ?? 0) > LIMITS.instruction) return bad("The request is too long (4,000 character limit).", 413);
  for (const f of [b.selection, b.input, b.expectedOutput, b.context, b.execution?.stdout, b.execution?.stderr, b.execution?.diagnostics])
    if ((str(f)?.length ?? 0) > LIMITS.field) return bad("An input, output, or error field is too large (20 KB limit).", 413);
  if (JSON.stringify(b).length > LIMITS.total) return bad("The request is too large.", 413);
  if (b.mode === "ask" && !str(b.instruction)?.trim()) return bad("Type a question.");
  return {
    mode: b.mode as AssistMode,
    instruction: str(b.instruction),
    file: b.file ? { path: b.file.path, content: b.file.content } : undefined,
    selection: str(b.selection),
    input: str(b.input),
    expectedOutput: str(b.expectedOutput),
    execution: b.execution && typeof b.execution.status === "string"
      ? { status: b.execution.status, stdout: str(b.execution.stdout), stderr: str(b.execution.stderr), exitCode: typeof b.execution.exitCode === "number" ? b.execution.exitCode : null, diagnostics: str(b.execution.diagnostics) }
      : undefined,
    context: str(b.context),
  };
}

const TASK: Record<AssistMode, string> = {
  explain_code: "Explain what this code does, step by step, for a learner. Do not rewrite it.",
  find_bug: "Find the bug or bugs. Point to the exact lines and explain why each is wrong, then give a corrected version of the file.",
  implement_method: "Help implement the unfinished method or methods (look for TODO comments or empty bodies). Explain the approach, then give the completed file.",
  suggest_fix: "Suggest a fix for the problem described. Explain the change, then give the corrected file.",
  explain_compiler_error: "Explain each compiler error in plain language, what causes it, and how to fix it. Then give a corrected file.",
  predict_behavior: "Predict what this program will do and print, by reasoning through the code. You have NOT run it; say so clearly, and recommend running it to confirm.",
  explain_output: "Explain how the program processes the given input to produce the actual output. Walk through the relevant code paths.",
  compare_output: "Explain why the actual output differs from the expected output, which code causes the difference, and what to change. If they match, say so.",
  generate_test_input: "Generate a few useful test inputs for this program in its exact input format, each with a one-line note on what it tests. Do not claim what the outputs are unless you clearly label them as predictions.",
  suggest_edge_cases: "List the edge cases this code should handle, whether it currently handles each one (based on reading the code), and how to test them.",
  explain_complexity: "Explain the time and space complexity of this code, with reasoning tied to its loops, recursion, and data structures.",
  ask: "Answer the user's question about their code.",
};

const SYSTEM = [
  "You are the code writer inside codeviz, a Java learning environment that compiles and runs code on Java 21.",
  "Write correct, readable Java 21 using only the JDK. No external libraries.",
  "Be clear and approachable, like a patient tutor. Keep answers focused and reasonably short.",
  "Honesty rules: never invent compiler output, program output, or test results.",
  "Only an EXECUTION RESULT section reports something that actually ran; anything else you say about output is a prediction and must be labeled as one.",
  "If information needed to answer is missing (for example, there is no program or no problem statement), say what is missing instead of guessing.",
  "When you provide a corrected or completed file, put the entire file in a single ```java code block, keep the same class name, and explain the changes outside the block.",
  "When asked only to explain, do not rewrite the file.",
].join("\n");

const block = (title: string, body: string | undefined) => (body !== undefined && body !== "" ? `\n\n### ${title}\n\`\`\`\n${body}\n\`\`\`` : "");

export function buildMessages(r: AssistRequest) {
  const exec = r.execution;
  const parts = [
    `TASK: ${TASK[r.mode]}`,
    r.instruction ? `\n\nUSER REQUEST: ${r.instruction}` : "",
    r.file ? `\n\n### FILE ${r.file.path}\n\`\`\`java\n${r.file.content}\n\`\`\`` : "\n\n(No source file was provided.)",
    block("SELECTED CODE", r.selection),
    block("GIVEN INPUT (stdin)", r.input),
    block("USER-PROVIDED EXPECTED OUTPUT", r.expectedOutput),
    exec
      ? `\n\n### EXECUTION RESULT (the program really ran in the sandbox)\nstatus: ${exec.status}${exec.exitCode !== null && exec.exitCode !== undefined ? `, exit code ${exec.exitCode}` : ""}` +
        block("actual stdout", exec.stdout ?? "") + block("stderr", exec.stderr) + block("compiler diagnostics", exec.diagnostics)
      : r.mode === "explain_output" || r.mode === "compare_output"
        ? "\n\n(The program has NOT been run, so there is no actual output. Say so and suggest running it first.)"
        : "",
    block("ADDITIONAL CONTEXT FROM THE USER", r.context),
  ];
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: parts.join("") },
  ];
}

/** Removes reasoning traces some Nemotron models emit before the answer. */
export function stripReasoning(text: string) {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^[\s\S]*?<\/think>/, "").trim();
}

export function extractSuggestion(text: string, mode: AssistMode, path: string | undefined) {
  if (!CHANGES_CODE.has(mode) || !path) return null;
  const blocks = [...text.matchAll(/```(?:java)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const full = blocks.find((b) => /\b(class|record|interface|enum)\s+\w+/.test(b));
  return full ? { code: full.replace(/\s+$/, "") + "\n", path } : null;
}

export async function assist(r: AssistRequest, fetchImpl: typeof fetch = fetch): Promise<AssistResponse | AssistError> {
  const cfg = config();
  if (!cfg.key) return { status: 503, code: "not_configured", message: "Nemotron isn't set up yet. Add NVIDIA_NEMOTRON_API_KEY to web/.env.local and restart the web app." };
  let res: Response;
  try {
    res = await fetchImpl(`${cfg.base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ model: cfg.model, messages: buildMessages(r), temperature: 0.2, top_p: 0.95, max_tokens: 4096, stream: false }),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
  } catch (e) {
    const timeout = (e as Error).name === "TimeoutError" || (e as Error).name === "AbortError";
    return timeout
      ? { status: 504, code: "timeout", message: "Nemotron took too long to answer. Try again, or ask about a smaller piece of code." }
      : { status: 502, code: "unreachable", message: "The server couldn't reach NVIDIA's API. Check the server's internet connection." };
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) return { status: 502, code: "auth_failed", message: "NVIDIA rejected the API key. Check NVIDIA_NEMOTRON_API_KEY in web/.env.local." };
    if (res.status === 404) return { status: 502, code: "model_unavailable", message: `The model ${cfg.model} isn't available to this key. Set NVIDIA_NEMOTRON_MODEL to a model from your build.nvidia.com catalog.` };
    if (res.status === 429) {
      const wait = res.headers.get("retry-after");
      return { status: 429, code: "rate_limited", message: `NVIDIA's rate limit was reached.${wait ? ` Try again in ${wait} seconds.` : " Wait a moment and try again."}` };
    }
    if (res.status === 400 || res.status === 422) return { status: 502, code: "provider_rejected", message: "NVIDIA's API rejected the request. The request may be too long for the model." };
    return { status: 502, code: "provider_error", message: `NVIDIA's API had a problem (HTTP ${res.status}). Try again shortly.` };
  }
  const data = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string | null } }[] } | null;
  const raw = data?.choices?.[0]?.message?.content;
  if (typeof raw !== "string" || !stripReasoning(raw)) return { status: 502, code: "empty_response", message: "Nemotron returned an empty answer. Try rephrasing." };
  const text = stripReasoning(raw);
  return { text, suggestion: extractSuggestion(text, r.mode, r.file?.path), model: cfg.model };
}
