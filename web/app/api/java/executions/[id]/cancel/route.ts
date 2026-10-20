import { forward } from "@/lib/server/runner";

const ID = /^[0-9a-f-]{36}$/;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID.test(id)) return Response.json({ error: { code: "not_found", message: "Unknown execution." } }, { status: 404 });
  return forward(req, `/v1/executions/${id}/cancel`, { method: "POST" });
}
