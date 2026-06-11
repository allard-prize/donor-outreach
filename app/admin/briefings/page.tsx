import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { briefings } from "@/lib/db/schema";

export default async function BriefingsPage() {
  const rows = await db
    .select({
      id: briefings.id,
      sentAt: briefings.sentAt,
      subject: briefings.subject,
      recipients: briefings.recipients,
      prospectCount: briefings.prospectCount,
      alertCount: briefings.alertCount,
      llmCostUsd: briefings.llmCostUsd,
      status: briefings.status,
    })
    .from(briefings)
    .orderBy(desc(briefings.sentAt))
    .limit(100);

  return (
    <main>
      <h1 className="text-xl font-semibold">Briefings</h1>
      <p className="mt-1 text-sm text-zinc-500">
        One row per weekly run — a row with 0 alerts means the run completed but nothing
        crossed the alert threshold. A missing Tuesday row means the cron didn&apos;t run.
      </p>

      <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-medium">Sent</th>
              <th className="px-3 py-2 font-medium">Subject</th>
              <th className="px-3 py-2 font-medium">Prospects</th>
              <th className="px-3 py-2 font-medium">Alerts</th>
              <th className="px-3 py-2 font-medium">LLM cost</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-zinc-400">No briefings yet.</td></tr>
            )}
            {rows.map((b) => (
              <tr key={b.id} className="border-t border-zinc-100">
                <td className="px-3 py-2 whitespace-nowrap text-zinc-500">
                  {b.sentAt.toISOString().replace("T", " ").slice(0, 16)} UTC
                </td>
                <td className="max-w-sm px-3 py-2">
                  <Link href={`/admin/briefings/${b.id}`} className="line-clamp-1 hover:underline">
                    {b.subject || "(no subject — zero-alert sentinel)"}
                  </Link>
                </td>
                <td className="px-3 py-2">{b.prospectCount}</td>
                <td className="px-3 py-2">{b.alertCount}</td>
                <td className="px-3 py-2 font-mono text-xs">${b.llmCostUsd}</td>
                <td className="px-3 py-2">
                  <span
                    className={
                      b.status === "sent"
                        ? "text-green-700"
                        : b.status === "failed"
                          ? "text-red-700"
                          : "text-amber-700"
                    }
                  >
                    {b.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
