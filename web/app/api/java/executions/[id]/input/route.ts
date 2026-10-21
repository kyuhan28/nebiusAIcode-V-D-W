import { forward } from "@/lib/server/runner";

const ID = /^[0-9a-f-]{36}$/;

/** Input typed into the terminal for an interactive run, passed on to the runner: {"text": "...", "eof": false}. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID.test(id)) return Response.json({ error: { code: "not_found", message: "Unknown execution." } }, { status: 404 });
  const b = (await req.json().catch(() => null)) as { text?: unknown; eof?: unknown } | null;
  const text = typeof b?.text === "string" ? b.text : "";
  if (text.length > 16_384) return Response.json({ error: { code: "too_large", message: "Send at most 16 KB of input at a time." } }, { status: 413 });
  return forward(req, `/v1/executions/${id}/input`, { method: "POST", body: JSON.stringify({ text, eof: b?.eof === true }) });
}
