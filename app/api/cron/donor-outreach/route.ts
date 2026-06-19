import { NextResponse } from "next/server";
import { runJob } from "@/lib/cron-runs/run-job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Weekly run can be slow — Vercel Hobby tier caps maxDuration at 60s for
// route handlers, so the agent loop must batch within that budget. If the
// prospect count grows beyond what fits in 60s we'll need to chunk by week-of-
// month or upgrade tier.
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const startedAt = Date.now();
  const r = await runJob("donor_outreach");
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
