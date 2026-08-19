import { recordRunFinish, recordRunStart } from "@/lib/cron-runs/recorder";
import { captureRss } from "@/lib/sources/rss";
import { captureGmail } from "@/lib/sources/gmail";
import { captureLinkedIn } from "@/lib/sources/linkedin";
import { runDonorOutreach } from "@/lib/llm/donor-outreach";

// The jobs that have a cron route + can be triggered on demand (health_check
// has no route).
export type RunnableJob = "rss" | "email_capture" | "linkedin_scrape" | "donor_outreach";

export type JobResult =
  | { ok: true; cronRunId: string; summary: Record<string, unknown> }
  | { ok: false; cronRunId: string; error: string };

/**
 * Run a job with full cron_run recording — the single source of truth shared by
 * the Vercel Cron routes and the dashboard "Run now" button, so both behave
 * identically (same recording, same outcome classification).
 */
export async function runJob(job: RunnableJob): Promise<JobResult> {
  const run = await recordRunStart(job);
  try {
    let outcome: "success" | "partial" = "success";
    let itemsProcessed = 0;
    let summary: Record<string, unknown> = {};

    switch (job) {
      case "rss": {
        const s = await captureRss();
        outcome = s.feedsFailed > 0 ? "partial" : "success";
        itemsProcessed = s.itemsInserted;
        summary = { ...s };
        break;
      }
      case "email_capture": {
        const s = await captureGmail();
        outcome = s.prospectsFailed.length > 0 ? "partial" : "success";
        itemsProcessed = s.messagesInserted;
        summary = { ...s };
        break;
      }
      case "linkedin_scrape": {
        const s = await captureLinkedIn();
        outcome =
          s.prospectsFailed.length > 0 || s.prospectsTimedOut > 0 ? "partial" : "success";
        itemsProcessed = s.postsInserted;
        summary = { ...s };
        break;
      }
      case "donor_outreach": {
        const s = await runDonorOutreach({ cronRunId: run.id });
        // A run where *every* prospect failed is a failure, not a partial —
        // nothing was scored and no digest went out. Classifying it `partial`
        // made a total outage read like a mostly-fine week in the health
        // check, which is how the Aug 2026 OpenRouter 402 outage ran for four
        // weeks before anyone looked.
        if (s.prospectsAggregated > 0 && s.prospectsFailed === s.prospectsAggregated) {
          await recordRunFinish(run.id, "failure", {
            itemsProcessed: s.resultsProcessed,
            metadata: { ...s },
            errorMessage: firstFailureMessage(s.failures),
          });
          return { ok: false, cronRunId: run.id, error: firstFailureMessage(s.failures) ?? "all prospects failed" };
        }
        outcome =
          s.prospectsFailed > 0 || s.briefingsFailed > 0 || s.prospectsDeferred > 0
            ? "partial"
            : "success";
        itemsProcessed = s.resultsProcessed;
        summary = { ...s };
        break;
      }
      default: {
        const _exhaustive: never = job;
        throw new Error(`Unknown job: ${_exhaustive as string}`);
      }
    }

    await recordRunFinish(run.id, outcome, { itemsProcessed, metadata: summary });
    return { ok: true, cronRunId: run.id, summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordRunFinish(run.id, "failure", { errorMessage: message });
    return { ok: false, cronRunId: run.id, error: message };
  }
}

/**
 * The most useful one-line reason from a batch of per-prospect failures. Every
 * prospect usually fails for the same upstream cause (expired token, no
 * OpenRouter credit), so the first one is representative — and putting it in
 * `error_message` is what gets it into the weekly health-check email.
 */
function firstFailureMessage(
  failures: { stage: string; error: string }[]
): string | undefined {
  const f = failures[0];
  if (!f) return undefined;
  return `all ${failures.length} prospect(s) failed at ${f.stage}: ${f.error.slice(0, 300)}`;
}
