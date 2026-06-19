"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";

// Maps the cron_job_name enum to its route path. health_check has no route.
const JOB_PATHS: Record<string, string> = {
  rss: "/api/cron/rss",
  email_capture: "/api/cron/email-capture",
  linkedin_scrape: "/api/cron/linkedin-scrape",
  donor_outreach: "/api/cron/donor-outreach",
};

/**
 * Trigger a cron job on demand by calling its route with the CRON_SECRET — the
 * same path Vercel Cron uses, so cron_run recording + behaviour are identical.
 * NOTE: running donor_outreach sends the real weekly digest email.
 */
export async function runCronNow(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) throw new Error("Unauthorized");

  const job = String(formData.get("job") ?? "");
  const path = JOB_PATHS[job];
  if (!path) throw new Error(`No route for job: ${job}`);

  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET is not set");
  const base = process.env.AUTH_URL ?? "http://localhost:3000";

  const res = await fetch(`${base}${path}`, {
    headers: { Authorization: `Bearer ${secret}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${job} run failed (${res.status}): ${body.slice(0, 200)}`);
  }
  revalidatePath("/admin/health");
}
