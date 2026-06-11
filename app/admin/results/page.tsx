import Link from "next/link";
import { and, asc, count, desc, eq, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { prospects, results, sourceType, processedStatus } from "@/lib/db/schema";

const PAGE_SIZE = 50;

export default async function ResultsPage({
  searchParams,
}: {
  searchParams: Promise<{
    prospect?: string;
    sourceType?: string;
    status?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const stFilter = sourceType.enumValues.find((v) => v === params.sourceType);
  const psFilter = processedStatus.enumValues.find((v) => v === params.status);
  const prospectFilter = (params.prospect ?? "").trim() || undefined;

  const where: SQL[] = [];
  if (stFilter) where.push(eq(results.sourceType, stFilter));
  if (psFilter) where.push(eq(results.processedStatus, psFilter));
  if (prospectFilter) where.push(eq(results.prospectId, prospectFilter));
  const whereExpr = where.length ? and(...where) : undefined;

  const [rows, [{ value: total }], prospectOptions] = await Promise.all([
    db
      .select({
        id: results.id,
        title: results.title,
        link: results.link,
        sourceType: results.sourceType,
        pubDate: results.pubDate,
        processedStatus: results.processedStatus,
        prospectName: prospects.fullName,
      })
      .from(results)
      .innerJoin(prospects, eq(results.prospectId, prospects.id))
      .where(whereExpr)
      .orderBy(desc(results.pubDate))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ value: count() }).from(results).where(whereExpr),
    db
      .select({ id: prospects.id, fullName: prospects.fullName })
      .from(prospects)
      .orderBy(asc(prospects.fullName)),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (overrides: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const merged = {
      prospect: prospectFilter,
      sourceType: stFilter,
      status: psFilter,
      ...overrides,
    };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `?${s}` : "";
  };

  return (
    <main>
      <h1 className="text-xl font-semibold">
        Signal queue <span className="text-sm font-normal text-zinc-500">({total} rows)</span>
      </h1>

      <form method="get" className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 bg-white p-4 text-sm">
        <label className="font-medium text-zinc-700">
          Prospect
          <select name="prospect" defaultValue={prospectFilter ?? ""} className="mt-1 block rounded border border-zinc-300 px-2 py-1.5">
            <option value="">All</option>
            {prospectOptions.map((p) => (
              <option key={p.id} value={p.id}>{p.fullName}</option>
            ))}
          </select>
        </label>
        <label className="font-medium text-zinc-700">
          Source
          <select name="sourceType" defaultValue={stFilter ?? ""} className="mt-1 block rounded border border-zinc-300 px-2 py-1.5">
            <option value="">All</option>
            {sourceType.enumValues.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </label>
        <label className="font-medium text-zinc-700">
          Status
          <select name="status" defaultValue={psFilter ?? ""} className="mt-1 block rounded border border-zinc-300 px-2 py-1.5">
            <option value="">All</option>
            {processedStatus.enumValues.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded bg-zinc-900 px-3 py-1.5 font-medium text-white hover:bg-zinc-700">
          Filter
        </button>
        <Link href="/admin/results" className="text-xs text-zinc-500 hover:underline">
          Clear
        </Link>
      </form>

      <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-medium">Prospect</th>
              <th className="px-3 py-2 font-medium">Title</th>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Published</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-zinc-400">No results.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-zinc-100">
                <td className="px-3 py-2 whitespace-nowrap">{r.prospectName}</td>
                <td className="max-w-md px-3 py-2">
                  {r.link ? (
                    <a href={r.link} target="_blank" rel="noopener noreferrer" className="line-clamp-1 hover:underline">
                      {r.title}
                    </a>
                  ) : (
                    <span className="line-clamp-1">{r.title}</span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{r.sourceType}</td>
                <td className="px-3 py-2 whitespace-nowrap text-zinc-500">
                  {r.pubDate.toISOString().slice(0, 10)}
                </td>
                <td className="px-3 py-2">
                  <span className={r.processedStatus === "pending" ? "text-amber-700" : "text-zinc-500"}>
                    {r.processedStatus}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="mt-3 flex items-center gap-3 text-sm">
          {page > 1 && (
            <Link href={`/admin/results${qs({ page: String(page - 1) })}`} className="text-blue-600 hover:underline">
              ← Prev
            </Link>
          )}
          <span className="text-zinc-500">Page {page} of {pages}</span>
          {page < pages && (
            <Link href={`/admin/results${qs({ page: String(page + 1) })}`} className="text-blue-600 hover:underline">
              Next →
            </Link>
          )}
        </div>
      )}
    </main>
  );
}
