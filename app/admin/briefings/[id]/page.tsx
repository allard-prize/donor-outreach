import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { briefings } from "@/lib/db/schema";

export default async function BriefingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [b] = await db.select().from(briefings).where(eq(briefings.id, id));
  if (!b) notFound();

  return (
    <main>
      <Link href="/admin/briefings" className="text-xs text-zinc-500 hover:underline">
        ← Briefings
      </Link>
      <h1 className="mt-2 text-xl font-semibold">
        {b.subject || "(no subject — zero-alert sentinel)"}
      </h1>
      <dl className="mt-3 grid max-w-lg grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <dt className="text-zinc-500">Sent</dt>
        <dd>{b.sentAt.toISOString().replace("T", " ").slice(0, 16)} UTC</dd>
        <dt className="text-zinc-500">Recipients</dt>
        <dd>{b.recipients.join(", ") || "—"}</dd>
        <dt className="text-zinc-500">Prospects / alerts</dt>
        <dd>{b.prospectCount} / {b.alertCount}</dd>
        <dt className="text-zinc-500">LLM cost / calls</dt>
        <dd className="font-mono text-xs">${b.llmCostUsd} / {b.llmCallCount}</dd>
        <dt className="text-zinc-500">Status</dt>
        <dd>{b.status}{b.errorMessage ? ` — ${b.errorMessage}` : ""}</dd>
      </dl>

      <h2 className="mt-6 text-sm font-semibold text-zinc-700">Email body</h2>
      {b.htmlBody ? (
        // Sandboxed iframe: stored HTML renders with no scripts and no same-origin access.
        <iframe
          srcDoc={b.htmlBody}
          sandbox=""
          title="Briefing email body"
          className="mt-2 h-[70vh] w-full rounded-lg border border-zinc-200 bg-white"
        />
      ) : (
        <p className="mt-2 text-sm text-zinc-400">No body stored (zero-alert run).</p>
      )}
    </main>
  );
}
