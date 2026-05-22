import { NextResponse } from "next/server";
import { captureRss } from "@/lib/sources/rss";
import { recordRunStart, recordRunFinish } from "@/lib/cron-runs/recorder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const startedAt = Date.now();
  const run = await recordRunStart("rss");
  try {
    const summary = await captureRss();
    const outcome = summary.feedsFailed > 0 ? "partial" : "success";
    await recordRunFinish(run.id, outcome, {
      itemsProcessed: summary.itemsInserted,
      metadata: { ...summary },
    });
    return NextResponse.json({
      ok: true,
      durationMs: Date.now() - startedAt,
      cronRunId: run.id,
      ...summary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordRunFinish(run.id, "failure", { errorMessage: message });
    return NextResponse.json(
      {
        ok: false,
        durationMs: Date.now() - startedAt,
        cronRunId: run.id,
        error: message,
      },
      { status: 500 }
    );
  }
}

function isAuthorized(request: Request): boolean {
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET>
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${expected}`;
}
