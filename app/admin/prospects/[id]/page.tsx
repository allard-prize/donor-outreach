import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { prospects } from "@/lib/db/schema";
import { updateProspect } from "../actions";
import { ProspectForm } from "../prospect-form";

export default async function EditProspectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [prospect] = await db.select().from(prospects).where(eq(prospects.id, id));
  if (!prospect) notFound();

  const updateWithId = updateProspect.bind(null, prospect.id);

  return (
    <main>
      <h1 className="text-xl font-semibold">Edit prospect</h1>
      <p className="mt-1 font-mono text-xs text-zinc-400">id: {prospect.id}</p>
      <ProspectForm
        action={updateWithId}
        prospect={prospect}
        submitLabel="Save changes"
      />
    </main>
  );
}
