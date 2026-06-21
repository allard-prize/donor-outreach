import { and, desc, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { briefings, cronRuns } from "@/lib/db/schema";

const SPEND_CAP_USD = 25;

// Max acceptable time since the last *successful* run, per scheduled job. A job
// with no success inside this window is flagged "overdue" (its cron is likely
// broken). Daily jobs allow ~2 days of slack; weekly jobs ~8. health_check
// itself is not monitored here.
const MAX_GAP_MS: Record<string, number> = {
  rss: 2 * 24 * 60 * 60 * 1000,
  email_capture: 2 * 24 * 60 * 60 * 1000,
  linkedin_scrape: 8 * 24 * 60 * 60 * 1000,
  donor_outreach: 8 * 24 * 60 * 60 * 1000,
};

export type JobHealth = {
  job: string;
  lastRunAt: Date | null;
  lastStatus: string | null;
  lastSuccessAt: Date | null;
  overdue: boolean;
};

export type FailureRow = {
  job: string;
  status: string;
  startedAt: Date;
  errorMessage: string | null;
};

export type HealthReport = {
  ok: boolean;
  now: Date;
  mtdSpendUsd: number;
  mtdCalls: number;
  spendCapUsd: number;
  overCap: boolean;
  jobs: JobHealth[];
  failures: FailureRow[];
  concerns: string[];
};

export async function buildHealthReport(): Promise<HealthReport> {
  const [recentRuns, mtdRows, failureRows, nowRes] = await Promise.all([
    db.select().from(cronRuns).orderBy(desc(cronRuns.startedAt)).limit(200),
    db
      .select({
        cost: sql<string>`coalesce(sum(${briefings.llmCostUsd}), 0)`,
        calls: sql<number>`coalesce(sum(${briefings.llmCallCount}), 0)`,
      })
      .from(briefings)
      .where(gte(briefings.sentAt, sql`date_trunc('month', now())`)),
    db
      .select()
      .from(cronRuns)
      .where(
        and(
          inArray(cronRuns.status, ["failure", "partial"]),
          gte(cronRuns.startedAt, sql`now() - interval '7 days'`)
        )
      )
      .orderBy(desc(cronRuns.startedAt)),
    db.execute(sql`select now() as now`),
  ]);

  const now = new Date(String(nowRes.rows[0]?.now ?? ""));
  const mtdSpendUsd = Number(mtdRows[0]?.cost ?? 0);
  const mtdCalls = Number(mtdRows[0]?.calls ?? 0);
  const overCap = mtdSpendUsd > SPEND_CAP_USD;

  const concerns: string[] = [];

  const jobs: JobHealth[] = Object.keys(MAX_GAP_MS).map((job) => {
    const runs = recentRuns.filter((r) => r.jobName === job);
    const lastRun = runs[0] ?? null;
    const lastSuccess = runs.find((r) => r.status === "success") ?? null;
    const lastSuccessAt = lastSuccess?.startedAt ?? null;
    const overdue =
      lastSuccessAt == null ||
      now.getTime() - lastSuccessAt.getTime() > MAX_GAP_MS[job];
    if (overdue) {
      concerns.push(
        lastSuccessAt
          ? `${job}: no successful run since ${fmtUtc(lastSuccessAt)} (expected more recently)`
          : `${job}: no successful run on record`
      );
    }
    return {
      job,
      lastRunAt: lastRun?.startedAt ?? null,
      lastStatus: lastRun?.status ?? null,
      lastSuccessAt,
      overdue,
    };
  });

  const failures: FailureRow[] = failureRows.map((r) => ({
    job: r.jobName,
    status: r.status,
    startedAt: r.startedAt,
    errorMessage: r.errorMessage,
  }));
  for (const f of failures) {
    concerns.push(
      `${f.job} ${f.status} at ${fmtUtc(f.startedAt)}${f.errorMessage ? `: ${f.errorMessage}` : ""}`
    );
  }

  if (overCap) {
    concerns.push(
      `LLM spend $${mtdSpendUsd.toFixed(2)} exceeds the $${SPEND_CAP_USD} monthly cap`
    );
  }

  return {
    ok: concerns.length === 0,
    now,
    mtdSpendUsd,
    mtdCalls,
    spendCapUsd: SPEND_CAP_USD,
    overCap,
    jobs,
    failures,
    concerns,
  };
}

export function renderHealthEmail(r: HealthReport): { subject: string; html: string } {
  const subject = r.ok
    ? "✅ Donor Outreach — weekly health check: all normal"
    : `⚠️ Donor Outreach — weekly health check: ${r.concerns.length} issue(s) to look at`;

  const concernsBlock = r.ok
    ? `<p style="color:#15803d;font-weight:600;">Everything looks fine — all scheduled jobs ran successfully and spend is within budget.</p>`
    : `<p style="color:#b91c1c;font-weight:600;">The system needs attention:</p>
       <ul>${r.concerns.map((c) => `<li style="color:#b91c1c;">${escapeHtml(c)}</li>`).join("")}</ul>`;

  const rows = r.jobs
    .map((j) => {
      const status = j.lastStatus ?? "never";
      const color = j.overdue
        ? "#b91c1c"
        : status === "success"
          ? "#15803d"
          : status === "partial"
            ? "#b45309"
            : "#71717a";
      return `<tr>
        <td style="padding:6px 10px;font-family:monospace;font-size:12px;">${escapeHtml(j.job)}</td>
        <td style="padding:6px 10px;color:${color};">${escapeHtml(status)}${j.overdue ? " (overdue)" : ""}</td>
        <td style="padding:6px 10px;color:#71717a;">${j.lastRunAt ? fmtUtc(j.lastRunAt) : "never"}</td>
        <td style="padding:6px 10px;color:#71717a;">${j.lastSuccessAt ? fmtUtc(j.lastSuccessAt) : "never"}</td>
      </tr>`;
    })
    .join("");

  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#18181b;max-width:640px;">
    <h2 style="margin-bottom:4px;">Donor Outreach — Weekly Health Check</h2>
    <p style="color:#71717a;margin-top:0;font-size:13px;">As of ${fmtUtc(r.now)}. This email is sent every week — if it stops arriving, the system itself may be down.</p>
    ${concernsBlock}
    <h3 style="margin-bottom:6px;">Scheduled jobs</h3>
    <table style="border-collapse:collapse;font-size:13px;border:1px solid #e4e4e7;">
      <thead><tr style="background:#fafafa;color:#71717a;text-align:left;font-size:11px;">
        <th style="padding:6px 10px;">Job</th><th style="padding:6px 10px;">Last status</th>
        <th style="padding:6px 10px;">Last run</th><th style="padding:6px 10px;">Last success</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <h3 style="margin-bottom:6px;">LLM spend</h3>
    <p style="font-size:13px;margin-top:0;">$${r.mtdSpendUsd.toFixed(2)} month-to-date of $${r.spendCapUsd} cap · ${r.mtdCalls} agent call(s).${r.overCap ? " <strong style=\"color:#b91c1c;\">Over cap.</strong>" : ""}</p>
    <p style="color:#a1a1aa;font-size:12px;margin-top:24px;">Automated weekly health check · Donor Outreach System.</p>
  </body></html>`;

  return { subject, html };
}

function fmtUtc(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
