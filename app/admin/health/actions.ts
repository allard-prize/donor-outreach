"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { runJob, type RunnableJob } from "@/lib/cron-runs/run-job";

const RUNNABLE: RunnableJob[] = ["rss", "email_capture", "linkedin_scrape", "donor_outreach"];

/**
 * Trigger a job on demand from the dashboard. Calls runJob directly (same shared
 * runner the cron routes use — identical cron_run recording), so there is no
 * HTTP self-call / AUTH_URL dependency. Throws on a failed run so the error
 * surfaces in the UI.
 */
export async function runCronNow(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) throw new Error("Unauthorized");

  const job = String(formData.get("job") ?? "") as RunnableJob;
  if (!RUNNABLE.includes(job)) throw new Error(`Not a runnable job: ${job}`);

  const result = await runJob(job);
  revalidatePath("/admin/health");
  if (!result.ok) {
    throw new Error(`${job} run failed: ${result.error}`);
  }
}
