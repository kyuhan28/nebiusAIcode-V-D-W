import { forward, sanitizedExecution } from "@/lib/server/runner";

export async function POST(req: Request) {
  const body = await sanitizedExecution(req);
  if (!body) return Response.json({ error: { code: "bad_request", message: "Send { mode, files: [{ path, content }], mainClass?, stdin? }." } }, { status: 400 });
  return forward(req, "/v1/executions", { method: "POST", body });
}
