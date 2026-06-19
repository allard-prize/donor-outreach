import { NextResponse } from "next/server";
import { runJob } from "@/lib/cron-runs/run-job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const startedAt = Date.now();
  const r = await runJob("email_capture");
  return NextResponse.json(
    r.ok
      ? { ok: true, durationMs: Date.now() - startedAt, cronRunId: r.cronRunId, ...r.summary }
      : { ok: false, durationMs: Date.now() - startedAt, cronRunId: r.cronRunId, error: r.error },
    { status: r.ok ? 200 : 500 }
  );
}

function isAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${expected}`;
}
