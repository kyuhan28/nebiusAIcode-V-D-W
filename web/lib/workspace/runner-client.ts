/** Browser client for the Java runner, through this app's /api/java routes. */
import type { RawTrace } from "../trace/interpret";

export type Diagnostic = { severity: "error" | "warning" | "info"; file: string | null; line: number | null; column: number | null; message: string };
export type ExecStatus =
  | "queued" | "compiling" | "running" | "completed" | "compile_failed" | "runtime_error" | "timed_out" | "cancelled" | "failed";
export type ExecResult = {
  status: ExecStatus;
  mode: "compile" | "run" | "trace";
  javaVersion: string;
  sandbox: string;
  diagnostics?: Diagnostic[];
  stdout?: string;
  stderr?: string;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
  exitCode?: number | null;
  durationMs?: number;
  compileMs?: number;
  entryPoint?: string;
  entryPoints?: { className: string; path: string }[];
  exception?: { type: string; message: string | null; sourcePath?: string; line?: number };
  error?: string;
  errorCode?: string;
  trace?: RawTrace;
};
export type Execution = { id: string; status: ExecStatus; result?: ExecResult };
export type Runtime = {
  javaVersion: string;
  javaVendor: string;
  compilerAvailable: boolean;
  sandbox: { level: "full" | "container" | "partial" | "docker" | "unavailable"; networkIsolated: boolean; traceNetworkIsolated: boolean; resourceLimits: boolean };
  docker?: { ready: boolean; image: string; serverVersion: string | null; problem: string | null };
  limits: { runTimeoutMs: number; traceTimeoutMs: number; maxSteps: number; heapMb: number };
};
export class RunnerError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new RunnerError(body?.error?.message ?? `The runner answered ${res.status}.`, body?.error?.code ?? "http_" + res.status);
  return body as T;
}

export const getRuntime = () => fetch("/api/java/runtime", { cache: "no-store" }).then((r) => json<Runtime>(r));

export const startExecution = (body: { mode: "compile" | "run" | "trace"; files: { path: string; content: string }[]; mainClass?: string | null; stdin?: string }) =>
  fetch("/api/java/executions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => json<Execution>(r));

export const cancelExecution = (id: string) =>
  fetch(`/api/java/executions/${id}/cancel`, { method: "POST" }).then((r) => json<Execution>(r));

/** Polls until the execution finishes, reporting stage changes along the way. */
export async function waitForExecution(id: string, onStatus: (s: ExecStatus) => void, signal: AbortSignal): Promise<Execution> {
  let delay = 150;
  for (;;) {
    if (signal.aborted) throw new RunnerError("Stopped", "aborted");
    const ex = await fetch(`/api/java/executions/${id}`, { cache: "no-store", signal }).then((r) => json<Execution>(r));
    onStatus(ex.status);
    if (ex.result) return ex;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.4, 700);
  }
}

