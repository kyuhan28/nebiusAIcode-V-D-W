import { config } from "@/lib/server/nemotron";

/** Whether Nemotron is configured, and which model. Never includes the key. */
export async function GET() {
  const cfg = config();
  return Response.json({ configured: cfg.key.length > 0, model: cfg.model }, { headers: { "Cache-Control": "no-store" } });
}
