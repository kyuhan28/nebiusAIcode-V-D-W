import { assist, validate } from "@/lib/server/nemotron";

/** POST /api/ai/code-assist: the code writer's only route to Nemotron. The key stays here. */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: { code: "bad_request", message: "Send JSON." } }, { status: 400 });
  }
  const parsed = validate(body);
  if ("code" in parsed && "status" in parsed) return Response.json({ error: { code: parsed.code, message: parsed.message } }, { status: parsed.status });
  const result = await assist(parsed);
  if ("status" in result) return Response.json({ error: { code: result.code, message: result.message } }, { status: result.status });
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
