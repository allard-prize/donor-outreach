import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cronRuns } from "@/lib/db/schema";

export type CronJobName =
  | "rss"
  | "email_capture"
  | "linkedin_scrape"
  | "donor_outreach"
  | "health_check";

export type CronRunOutcome = "success" | "failure" | "partial";

export type CronRunRecord = {
  id: string;
  startedAt: Date;
};

export async function recordRunStart(jobName: CronJobName): Promise<CronRunRecord> {
  const startedAt = new Date();
  const [row] = await db
    .insert(cronRuns)
    .values({ jobName, startedAt, status: "running" })
    .returning({ id: cronRuns.id, startedAt: cronRuns.startedAt });
  return { id: row.id, startedAt: row.startedAt };
}

export async function recordRunFinish(
  runId: string,
  outcome: CronRunOutcome,
  opts: {
    itemsProcessed?: number;
    errorMessage?: string | null;
    metadata?: Record<string, unknown>;
  } = {}
): Promise<void> {
  await db
    .update(cronRuns)
    .set({
      status: outcome,
      completedAt: new Date(),
      itemsProcessed: opts.itemsProcessed ?? 0,
      errorMessage: opts.errorMessage ?? null,
      metadata: opts.metadata,
    })
    .where(eq(cronRuns.id, runId));
}
