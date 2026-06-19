import { and, desc, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { briefings, cronRuns, cronJobName, evalRuns } from "@/lib/db/schema";
import { RunNowButton } from "./run-now-button";

// Mirrors vercel.json. null = no schedule (health_check has no cron route).
const CRON_SCHEDULES: Record<string, { expr: string; label: string } | null> = {
  rss: { expr: "0 6 * * *", label: "daily 06:00" },
  email_capture: { expr: "30 6 * * *", label: "daily 06:30" },
  linkedin_scrape: { expr: "0 0 * * 1", label: "Sun night (Mon 00:00 UTC)" },
  donor_outreach: { expr: "0 2 * * 1", label: "Sun night (Mon 02:00 UTC)" },
  health_check: null,
};

// Next fire of a simple cron (`M H * * D` or `M H * * *`) at/after `now`, in UTC.
function nextCronRun(expr: string, now: Date): Date {
  const [min, hr, , , dow] = expr.split(" ");
  const d = new Date(now);
  d.setUTCHours(Number(hr), Number(min), 0, 0);
  if (dow === "*") {
    if (d <= now) d.setUTCDate(d.getUTCDate() + 1);
  } else {
    const target = Number(dow);
    let guard = 0;
    while ((d.getUTCDay() !== target || d <= now) && guard < 14) {
      d.setUTCDate(d.getUTCDate() + 1);
      guard += 1;
    }
  }
  return d;
}

function fmtUtc(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

// Group a cron_run's per-item failures (metadata.failures = [{stage, error, ...}])
// into "stage: error → count" so a partial run's reason is visible at a glance.
function failureReasons(metadata: unknown): { reason: string; count: number }[] {
  const fs = (metadata as { failures?: { stage?: string; error?: string }[] } | null)?.failures;
  if (!Array.isArray(fs) || fs.length === 0) return [];
  const by = new Map<string, number>();
  for (const f of fs) {
    const key = `${f.stage ?? "?"}: ${f.error ?? "?"}`;
    by.set(key, (by.get(key) ?? 0) + 1);
  }
  return [...by].map(([reason, count]) => ({ reason, count }));
}

// "Run now" on donor_outreach runs the full weekly digest inline — give the
// page's server actions the same 60s budget as the cron routes.
export const maxDuration = 60;

export default async function HealthPage() {
  // Time cutoffs computed in SQL — render must stay pure (no Date.now()).
  const [recentRuns, [mtd], recentFailures, recentEvalRuns, nowRes] = await Promise.all([
    db
      .select()
      .from(cronRuns)
      .orderBy(desc(cronRuns.startedAt))
      .limit(200),
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
    db.select().from(evalRuns).orderBy(desc(evalRuns.startedAt)).limit(5),
    db.execute(sql`select now() as now`),
  ]);

  const latestEval = recentEvalRuns[0];
  // `now` from SQL (not Date.now()) so the render stays pure.
  const now = new Date(String(nowRes.rows[0]?.now ?? ""));

  // Last run + last success per job + schedule/next-run, over the recent window.
  const jobs = cronJobName.enumValues.map((job) => {
    const runs = recentRuns.filter((r) => r.jobName === job);
    const sched = CRON_SCHEDULES[job] ?? null;
    return {
      job,
      lastRun: runs[0],
      lastSuccess: runs.find((r) => r.status === "success"),
      schedule: sched,
      nextRun: sched ? nextCronRun(sched.expr, now) : null,
      runnable: sched != null,
    };
  });

  return (
    <main>
      <h1 className="text-xl font-semibold">Health</h1>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-sm text-zinc-500">LLM spend (month to date)</p>
          <p className="mt-1 text-2xl font-semibold">
            ${Number(mtd.cost).toFixed(2)}
            <span className="ml-1 text-sm font-normal text-zinc-400">/ $25 cap</span>
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {mtd.calls} agent call(s) — from briefing logs; the hard cap is enforced at OpenRouter.
          </p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-sm text-zinc-500">Failures (past 7 days)</p>
          <p className={`mt-1 text-2xl font-semibold ${recentFailures.length ? "text-red-700" : ""}`}>
            {recentFailures.length}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-sm text-zinc-500">Runs recorded (window)</p>
          <p className="mt-1 text-2xl font-semibold">{recentRuns.length}</p>
        </div>
      </div>

      <h2 className="mt-8 text-sm font-semibold text-zinc-700">Per-job status</h2>
      <div className="mt-2 overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-medium">Job</th>
              <th className="px-3 py-2 font-medium">Last run</th>
              <th className="px-3 py-2 font-medium">Last status</th>
              <th className="px-3 py-2 font-medium">Next run</th>
              <th className="px-3 py-2 font-medium">Items</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {jobs.map(({ job, lastRun, schedule, nextRun, runnable }) => (
              <tr key={job} className="border-t border-zinc-100">
                <td className="px-3 py-2 font-mono text-xs">{job}</td>
                <td className="px-3 py-2 text-zinc-500">
                  {lastRun ? fmtUtc(lastRun.startedAt) : "never"}
                </td>
                <td className="px-3 py-2">
                  {lastRun ? (
                    <span
                      className={
                        lastRun.status === "success"
                          ? "text-green-700"
                          : lastRun.status === "failure"
                            ? "text-red-700"
                            : "text-amber-700"
                      }
                    >
                      {lastRun.status}
                    </span>
                  ) : (
                    <span className="text-zinc-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-zinc-500">
                  {nextRun ? (
                    <>
                      {fmtUtc(nextRun)}
                      <span className="ml-1 text-xs text-zinc-400">({schedule?.label})</span>
                    </>
                  ) : (
                    <span className="text-zinc-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2">{lastRun?.itemsProcessed ?? "—"}</td>
                <td className="px-3 py-2">
                  {runnable ? (
                    <RunNowButton
                      job={job}
                      warn={
                        job === "donor_outreach"
                          ? "Run the weekly digest now? This sends a real email to the configured recipients."
                          : undefined
                      }
                    />
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-8 text-sm font-semibold text-zinc-700">Eval harness</h2>
      {latestEval ? (
        <div className="mt-2 overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <div className="border-b border-zinc-100 p-4">
            <p className="text-sm text-zinc-500">Latest run</p>
            <p className="mt-1 text-2xl font-semibold">
              {latestEval.casesPassed}/{latestEval.caseCount}
              <span className="ml-1 text-sm font-normal text-zinc-400">cases clean</span>
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              {latestEval.totalViolations} violations (contract={latestEval.contractViolations}{" "}
              binary={latestEval.binaryViolations} rubric={latestEval.rubricViolations}) ·{" "}
              <span className="font-mono">{latestEval.model}</span> · prompt {latestEval.promptVersion} ·{" "}
              ${Number(latestEval.llmCostUsd).toFixed(4)} ·{" "}
              {latestEval.startedAt.toISOString().replace("T", " ").slice(0, 16)} UTC
            </p>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">Started</th>
                <th className="px-3 py-2 font-medium">Model</th>
                <th className="px-3 py-2 font-medium">Clean</th>
                <th className="px-3 py-2 font-medium">Violations</th>
                <th className="px-3 py-2 font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {recentEvalRuns.map((r) => (
                <tr key={r.id} className="border-t border-zinc-100">
                  <td className="px-3 py-2 whitespace-nowrap text-zinc-500">
                    {r.startedAt.toISOString().replace("T", " ").slice(0, 16)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.model}</td>
                  <td className="px-3 py-2">
                    {r.casesPassed}/{r.caseCount}
                  </td>
                  <td className={`px-3 py-2 ${r.totalViolations ? "text-amber-700" : "text-green-700"}`}>
                    {r.totalViolations}
                  </td>
                  <td className="px-3 py-2 text-zinc-500">${Number(r.llmCostUsd).toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-2 text-sm text-zinc-400">
          No eval runs yet — run <span className="font-mono">pnpm test:eval</span>.
        </p>
      )}

      {recentFailures.length > 0 && (
        <>
          <h2 className="mt-8 text-sm font-semibold text-red-700">
            Failures &amp; partial runs (past 7 days)
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            A <strong>partial</strong> run finished but some items failed (e.g. a few prospects).
            The breakdown below is each run&apos;s per-item failure reasons.
          </p>
          <div className="mt-2 space-y-2">
            {recentFailures.map((r) => {
              const reasons = failureReasons(r.metadata);
              return (
                <div key={r.id} className="rounded-lg border border-red-200 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-mono text-xs">{r.jobName}</span>
                    <span
                      className={
                        r.status === "failure"
                          ? "rounded bg-red-50 px-2 py-0.5 text-xs text-red-700"
                          : "rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700"
                      }
                    >
                      {r.status}
                    </span>
                    <span className="text-xs text-zinc-500">{fmtUtc(r.startedAt)}</span>
                  </div>
                  {r.errorMessage && (
                    <p className="mt-1 text-xs text-red-700">{r.errorMessage}</p>
                  )}
                  {reasons.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-xs text-zinc-600">
                      {reasons.map((x) => (
                        <li key={x.reason}>
                          <span className="font-medium">×{x.count}</span> {x.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </main>
  );
}
