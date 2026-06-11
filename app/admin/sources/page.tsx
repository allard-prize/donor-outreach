import { asc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { prospects, sources } from "@/lib/db/schema";
import { createSource, disableSource, enableSource } from "./actions";

export default async function SourcesPage() {
  const [rows, activeProspects] = await Promise.all([
    db
      .select({
        id: sources.id,
        rssUrl: sources.rssUrl,
        disabledAt: sources.disabledAt,
        prospectName: prospects.fullName,
      })
      .from(sources)
      .innerJoin(prospects, eq(sources.prospectId, prospects.id))
      .orderBy(asc(prospects.fullName), asc(sources.createdAt)),
    db
      .select({ id: prospects.id, fullName: prospects.fullName })
      .from(prospects)
      .where(isNull(prospects.archivedAt))
      .orderBy(asc(prospects.fullName)),
  ]);

  return (
    <main>
      <h1 className="text-xl font-semibold">RSS Sources</h1>

      <form
        action={createSource}
        className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 bg-white p-4"
      >
        <label className="text-sm font-medium text-zinc-700">
          Prospect
          <select
            name="prospectId"
            required
            className="mt-1 block rounded border border-zinc-300 px-3 py-2 text-sm"
          >
            {activeProspects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex-1 text-sm font-medium text-zinc-700">
          Feed URL
          <input
            name="rssUrl"
            required
            placeholder="https://… (RSS/Atom or Google Alerts feed)"
            className="mt-1 block w-full rounded border border-zinc-300 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
        >
          Add source
        </button>
      </form>

      <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-medium">Prospect</th>
              <th className="px-3 py-2 font-medium">Feed URL</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-zinc-400">
                  No sources.
                </td>
              </tr>
            )}
            {rows.map((s) => (
              <tr key={s.id} className="border-t border-zinc-100">
                <td className="px-3 py-2 font-medium">{s.prospectName}</td>
                <td className="max-w-md truncate px-3 py-2 font-mono text-xs text-zinc-600">
                  {s.rssUrl}
                </td>
                <td className="px-3 py-2">
                  {s.disabledAt ? (
                    <span className="text-zinc-400">disabled</span>
                  ) : (
                    <span className="text-green-700">active</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <form
                    action={async () => {
                      "use server";
                      if (s.disabledAt) await enableSource(s.id);
                      else await disableSource(s.id);
                    }}
                  >
                    <button
                      type="submit"
                      className="text-xs text-zinc-400 hover:text-zinc-700"
                    >
                      {s.disabledAt ? "Enable" : "Disable"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
