import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { briefings, cronRuns, cronJobName, evalRuns } from "@/lib/db/schema";

export default async function HealthPage() {
  // Time cutoffs computed in SQL — render must stay pure (no Date.now()).
  const [recentRuns, [mtd], recentFailures, recentEvalRuns] = await Promise.all([
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
          eq(cronRuns.status, "failure"),
          gte(cronRuns.startedAt, sql`now() - interval '7 days'`)
        )
      )
      .orderBy(desc(cronRuns.startedAt)),
    db.select().from(evalRuns).orderBy(desc(evalRuns.startedAt)).limit(5),
  ]);

  const latestEval = recentEvalRuns[0];

  // Last run + last success per job, computed over the recent window.
  const jobs = cronJobName.enumValues.map((job) => {
    const runs = recentRuns.filter((r) => r.jobName === job);
    return {
      job,
      lastRun: runs[0],
      lastSuccess: runs.find((r) => r.status === "success"),
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
              <th className="px-3 py-2 font-medium">Last success</th>
              <th className="px-3 py-2 font-medium">Items</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map(({ job, lastRun, lastSuccess }) => (
              <tr key={job} className="border-t border-zinc-100">
                <td className="px-3 py-2 font-mono text-xs">{job}</td>
                <td className="px-3 py-2 text-zinc-500">
                  {lastRun ? lastRun.startedAt.toISOString().replace("T", " ").slice(0, 16) + " UTC" : "never"}
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
                <td className="px-3 py-2 text-zinc-500">
                  {lastSuccess
                    ? lastSuccess.startedAt.toISOString().replace("T", " ").slice(0, 16) + " UTC"
                    : "none in window"}
                </td>
                <td className="px-3 py-2">{lastRun?.itemsProcessed ?? "—"}</td>
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
          <h2 className="mt-8 text-sm font-semibold text-red-700">Failures (past 7 days)</h2>
          <div className="mt-2 overflow-hidden rounded-lg border border-red-200 bg-white">
            <table className="w-full text-sm">
              <tbody>
                {recentFailures.map((r) => (
                  <tr key={r.id} className="border-t border-red-100">
                    <td className="px-3 py-2 font-mono text-xs">{r.jobName}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-zinc-500">
                      {r.startedAt.toISOString().replace("T", " ").slice(0, 16)} UTC
                    </td>
                    <td className="max-w-md px-3 py-2 text-xs text-red-700">
                      <span className="line-clamp-2">{r.errorMessage ?? "(no message)"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
