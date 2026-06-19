import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { monitoringResults, prospects } from "@/lib/db/schema";
import { updateProspect } from "../actions";
import { ProspectForm } from "../prospect-form";
import { AssessmentCard, type Assessment } from "@/app/admin/assessments/assessment-card";

export default async function EditProspectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [prospect] = await db.select().from(prospects).where(eq(prospects.id, id));
  if (!prospect) notFound();

  const updateWithId = updateProspect.bind(null, prospect.id);

  const assessments = await db
    .select()
    .from(monitoringResults)
    .where(eq(monitoringResults.prospectId, prospect.id))
    .orderBy(desc(monitoringResults.runDate))
    .limit(20);

  return (
    <main>
      <h1 className="text-xl font-semibold">Edit prospect</h1>
      <p className="mt-1 font-mono text-xs text-zinc-400">id: {prospect.id}</p>
      <ProspectForm
        action={updateWithId}
        prospect={prospect}
        submitLabel="Save changes"
      />

      <h2 className="mt-10 text-sm font-semibold text-zinc-700">
        Weekly assessments ({assessments.length})
      </h2>
      {assessments.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-400">No assessments yet for this prospect.</p>
      ) : (
        <div className="mt-2 space-y-3">
          {assessments.map((a) => (
            <AssessmentCard key={a.id} a={a as Assessment} />
          ))}
        </div>
      )}
    </main>
  );
}
