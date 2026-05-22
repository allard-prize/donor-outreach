import { NextResponse } from "next/server";
import { captureGmail } from "@/lib/sources/gmail";
import { recordRunStart, recordRunFinish } from "@/lib/cron-runs/recorder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const startedAt = Date.now();
  const run = await recordRunStart("email_capture");
  try {
    const summary = await captureGmail();
    const outcome = summary.prospectsFailed.length > 0 ? "partial" : "success";
    await recordRunFinish(run.id, outcome, {
      itemsProcessed: summary.messagesInserted,
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
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${expected}`;
}
