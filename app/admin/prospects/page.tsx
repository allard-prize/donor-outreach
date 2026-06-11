import Link from "next/link";
import { asc, eq, isNull, isNotNull, and, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { prospects, profileType } from "@/lib/db/schema";
import { archiveProspect, restoreProspect } from "./actions";
import { PROFILE_TYPE_LABELS } from "./prospect-form";

export default async function ProspectsPage({
  searchParams,
}: {
  searchParams: Promise<{ profileType?: string; archived?: string }>;
}) {
  const params = await searchParams;
  const showArchived = params.archived === "1";
  const ptFilter = profileType.enumValues.find((v) => v === params.profileType);

  const where: SQL[] = [
    showArchived ? isNotNull(prospects.archivedAt) : isNull(prospects.archivedAt),
  ];
  if (ptFilter) where.push(eq(prospects.profileType, ptFilter));

  const rows = await db
    .select()
    .from(prospects)
    .where(and(...where))
    .orderBy(asc(prospects.fullName));

  return (
    <main>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          Prospects {ptFilter ? `— ${PROFILE_TYPE_LABELS[ptFilter]}` : ""}
          {showArchived ? " — archived" : ""}
        </h1>
        <div className="flex items-center gap-3">
          <Link
            href={showArchived ? "/admin/prospects" : "/admin/prospects?archived=1"}
            className="text-xs text-zinc-500 hover:underline"
          >
            {showArchived ? "Show active" : "Show archived"}
          </Link>
          <Link
            href="/admin/prospects/new"
            className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700"
          >
            Add prospect
          </Link>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Profile type</th>
              <th className="px-3 py-2 font-medium">Capture</th>
              <th className="px-3 py-2 font-medium">Dossier</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-zinc-400">
                  No prospects.
                </td>
              </tr>
            )}
            {rows.map((p) => (
              <tr key={p.id} className="border-t border-zinc-100">
                <td className="px-3 py-2 font-medium">
                  <Link href={`/admin/prospects/${p.id}`} className="hover:underline">
                    {p.fullName}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <span
                    className={
                      p.profileType === "unknown" ? "text-amber-700" : "text-zinc-700"
                    }
                  >
                    {PROFILE_TYPE_LABELS[p.profileType] ?? p.profileType}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-zinc-500">
                  {[p.emailEnabled && "email", p.linkedInEnabled && "linkedin"]
                    .filter(Boolean)
                    .join(", ") || "—"}
                </td>
                <td className="px-3 py-2 text-xs text-zinc-500">
                  {p.dossierFileId ? p.dossierProvider : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  <form
                    action={async () => {
                      "use server";
                      if (showArchived) await restoreProspect(p.id);
                      else await archiveProspect(p.id);
                    }}
                  >
                    <button
                      type="submit"
                      className="text-xs text-zinc-400 hover:text-zinc-700"
                    >
                      {showArchived ? "Restore" : "Archive"}
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
