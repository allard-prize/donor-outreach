import { NextResponse } from "next/server";
import {
  runDonorOutreach,
  type DonorOutreachSummary,
} from "@/lib/llm/donor-outreach";
import { recordRunStart, recordRunFinish } from "@/lib/cron-runs/recorder";

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
  const run = await recordRunStart("donor_outreach");
  try {
    const summary: DonorOutreachSummary = await runDonorOutreach({
      cronRunId: run.id,
    });
    const outcome =
      summary.prospectsFailed > 0 || summary.briefingsFailed > 0
        ? "partial"
        : "success";
    await recordRunFinish(run.id, outcome, {
      itemsProcessed: summary.resultsProcessed,
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
