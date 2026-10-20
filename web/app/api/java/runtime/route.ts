import { connection } from "next/server";
import { forward } from "@/lib/server/runner";

export async function GET(req: Request) {
  await connection();
  return forward(req, "/v1/runtime", { method: "GET" });
}
