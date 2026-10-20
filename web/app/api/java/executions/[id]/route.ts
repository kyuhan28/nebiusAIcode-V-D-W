import { connection } from "next/server";
import { forward } from "@/lib/server/runner";

const ID = /^[0-9a-f-]{36}$/;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await ctx.params;
  if (!ID.test(id)) return Response.json({ error: { code: "not_found", message: "Unknown execution." } }, { status: 404 });
  return forward(req, `/v1/executions/${id}`, { method: "GET" });
}
