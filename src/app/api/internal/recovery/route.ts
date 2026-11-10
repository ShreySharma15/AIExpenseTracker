import { matchesSecret } from "@/server/secret";
import { processTelegramJobs } from "@/server/telegram/recovery";
import { reportEvent } from "@/server/monitoring";

export const runtime = "nodejs";
export const maxDuration = 50;

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    reportEvent("recovery_config", { status: 503 });
    return new Response(null, { status: 503 });
  }
  if (!matchesSecret(request.headers.get("authorization"), "Bearer " + secret)) {
    return new Response(null, { status: 401 });
  }
  try {
    const result = await processTelegramJobs();
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    reportEvent("recovery_failed", { status: 503 });
    return new Response(null, { status: 503 });
  }
}
