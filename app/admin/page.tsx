import Link from "next/link";
import { db } from "@/lib/db";
import { prospects, sources, results, cronRuns, monitoringResults } from "@/lib/db/schema";
import { isNull, eq, ne, count, desc, and, isNotNull } from "drizzle-orm";

export default async function AdminHomePage() {
  const [[activeProspects], [activeSources], [pendingResults], lastRuns] =
    await Promise.all([
      db.select({ value: count() }).from(prospects).where(isNull(prospects.archivedAt)),
      db.select({ value: count() }).from(sources).where(isNull(sources.disabledAt)),
      db
        .select({ value: count() })
        .from(results)
        .where(eq(results.processedStatus, "pending")),
      db
        .select({
          jobName: cronRuns.jobName,
          status: cronRuns.status,
          startedAt: cronRuns.startedAt,
        })
        .from(cronRuns)
        .orderBy(desc(cronRuns.startedAt))
        .limit(5),
    ]);

  const unknownProfiles = await db
    .select({ value: count() })
    .from(prospects)
    .where(and(isNull(prospects.archivedAt), eq(prospects.profileType, "unknown")));

  // Count assessments from the most recent weekly run that recommend a followup
  // action — i.e. the agent gave an actionable touchpoint (not no_action). Mirrors
  // the `actionable` rule used by the assessment cards.
  const [latestAssessmentWeek] = await db
    .select({ runDate: monitoringResults.runDate })
    .from(monitoringResults)
    .orderBy(desc(monitoringResults.runDate))
    .limit(1);

  const followupActions = latestAssessmentWeek
    ? (
        await db
          .select({ value: count() })
          .from(monitoringResults)
          .where(
            and(
              eq(monitoringResults.runDate, latestAssessmentWeek.runDate),
              isNotNull(monitoringResults.touchpointType),
              ne(monitoringResults.touchpointType, "no_action"),
            ),
          )
      )[0].value
    : 0;

  const cards = [
    { label: "Active prospects", value: activeProspects.value, href: "/admin/prospects" },
    { label: "Active RSS sources", value: activeSources.value, href: "/admin/sources" },
    { label: "Pending signals", value: pendingResults.value, href: null },
    { label: "Followup actions recommended", value: followupActions, href: "/admin/assessments" },
  ];

  return (
    <main>
      <h1 className="text-xl font-semibold">Dashboard</h1>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border border-zinc-200 bg-white p-4">
            <p className="text-sm text-zinc-500">{c.label}</p>
            <p className="mt-1 text-2xl font-semibold">{c.value}</p>
            {c.href && (
              <Link href={c.href} className="mt-1 inline-block text-xs text-blue-600 hover:underline">
                Manage →
              </Link>
            )}
          </div>
        ))}
      </div>

      {unknownProfiles[0].value > 0 && (
        <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {unknownProfiles[0].value} prospect(s) have profile type{" "}
          <span className="font-mono">unknown</span> (migrated from Phase 1).{" "}
          <Link href="/admin/prospects?profileType=unknown" className="underline">
            Classify them
          </Link>
          .
        </p>
      )}

      <h2 className="mt-8 text-sm font-semibold text-zinc-700">Recent cron runs</h2>
      <div className="mt-2 overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-medium">Job</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Started</th>
            </tr>
          </thead>
          <tbody>
            {lastRuns.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-zinc-400">
                  No cron runs recorded yet.
                </td>
              </tr>
            )}
            {lastRuns.map((r, i) => (
              <tr key={i} className="border-t border-zinc-100">
                <td className="px-3 py-2 font-mono text-xs">{r.jobName}</td>
                <td className="px-3 py-2">
                  <span
                    className={
                      r.status === "success"
                        ? "text-green-700"
                        : r.status === "failure"
                          ? "text-red-700"
                          : "text-amber-700"
                    }
                  >
                    {r.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-zinc-500">
                  {r.startedAt.toISOString().replace("T", " ").slice(0, 16)} UTC
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
