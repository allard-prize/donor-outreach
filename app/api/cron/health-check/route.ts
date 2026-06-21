import { NextResponse } from "next/server";
import { recordRunFinish, recordRunStart } from "@/lib/cron-runs/recorder";
import { buildHealthReport, renderHealthEmail } from "@/lib/health/check";
import { sendGmailHtml } from "@/lib/email/send";
import { parseRecipientsEnv } from "@/lib/email/send-briefing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const startedAt = Date.now();
  const run = await recordRunStart("health_check");
  try {
    const report = await buildHealthReport();
    const recipients = parseRecipientsEnv();

    let emailSent = false;
    let emailError: string | null = null;
    if (recipients.length === 0) {
      emailError = "No recipients configured (BRIEFING_RECIPIENTS).";
    } else {
      const { subject, html } = renderHealthEmail(report);
      try {
        await sendGmailHtml({
          from: "allard.prize.alerts@gmail.com",
          to: recipients,
          subject,
          htmlBody: html,
        });
        emailSent = true;
      } catch (e) {
        emailError = e instanceof Error ? e.message : String(e);
      }
    }

    // This job's own outcome is about whether the check ran + emailed — distinct
    // from report.ok, which is the health of the *monitored* system. If we can't
    // send the email, that's a real problem for the liveness signal, so mark
    // partial (not success) even when the monitored system is fine.
    const outcome = emailSent ? "success" : "partial";
    await recordRunFinish(run.id, outcome, {
      metadata: {
        systemOk: report.ok,
        concerns: report.concerns,
        mtdSpendUsd: report.mtdSpendUsd,
        emailSent,
        emailError,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        durationMs: Date.now() - startedAt,
        cronRunId: run.id,
        systemOk: report.ok,
        concerns: report.concerns,
        emailSent,
        emailError,
      },
      { status: 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordRunFinish(run.id, "failure", { errorMessage: message });
    return NextResponse.json(
      { ok: false, durationMs: Date.now() - startedAt, cronRunId: run.id, error: message },
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
