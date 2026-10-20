import { createHash } from "node:crypto";

/**
 * Server-side bridge to the Java runner service. The browser never talks to the runner
 * directly, so the runner token stays on the server and the runner can stay on a private network.
 */
const RUNNER_URL = (process.env.RUNNER_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const RUNNER_TOKEN = process.env.RUNNER_TOKEN ?? "";

function clientId(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

export async function forward(req: Request, path: string, init: { method: "GET" | "POST"; body?: string }) {
  try {
    const res = await fetch(`${RUNNER_URL}${path}`, {
      method: init.method,
      body: init.body,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-Codeviz-Client": clientId(req),
        ...(RUNNER_TOKEN ? { Authorization: `Bearer ${RUNNER_TOKEN}` } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    return new Response(text, { status: res.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { error: { code: "runner_offline", message: "The code runner isn't reachable, so programs can't run right now. Start it with ./runner/start.sh (or docker compose up -d runner), or check RUNNER_URL in web/.env.local." } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

/** Accepts only the fields the runner understands, so arbitrary options can't be smuggled through. */
export async function sanitizedExecution(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return null;
  }
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.files)) return null;
  const files = b.files
    .filter((f): f is { path: string; content: string } => !!f && typeof f.path === "string" && typeof f.content === "string")
    .map((f) => ({ path: f.path, content: f.content }));
  return JSON.stringify({
    mode: typeof b.mode === "string" ? b.mode : "run",
    files,
    mainClass: typeof b.mainClass === "string" ? b.mainClass : undefined,
    language: ["java", "python", "c", "cpp"].includes(b.language as string) ? b.language : undefined,
    stdin: typeof b.stdin === "string" ? b.stdin : "",
  });
}

/** Calls the runner and returns its JSON, for server code that needs the result itself. */
export async function callRunner(path: string, init: { method: "GET" | "POST"; body?: string; client?: string }) {
  const res = await fetch(`${RUNNER_URL}${path}`, {
    method: init.method,
    body: init.body,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-Codeviz-Client": init.client ?? "server",
      ...(RUNNER_TOKEN ? { Authorization: `Bearer ${RUNNER_TOKEN}` } : {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

export const clientIdFor = clientId;
