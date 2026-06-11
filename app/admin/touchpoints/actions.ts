"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { touchpointsPotential, touchpointsAssigned } from "@/lib/db/schema";

async function requireEmail(): Promise<string> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) throw new Error("Unauthorized");
  return email;
}

export async function approveTouchpoint(id: string) {
  const email = await requireEmail();
  await db
    .update(touchpointsPotential)
    .set({ reviewStatus: "approved", reviewedBy: email, reviewedAt: sql`now()` })
    .where(eq(touchpointsPotential.id, id));
  revalidatePath("/admin/touchpoints");
}

export async function rejectTouchpoint(id: string) {
  const email = await requireEmail();
  await db
    .update(touchpointsPotential)
    .set({ reviewStatus: "rejected", reviewedBy: email, reviewedAt: sql`now()` })
    .where(eq(touchpointsPotential.id, id));
  revalidatePath("/admin/touchpoints");
}

/**
 * Promote an approved touchpoint to touchpointsAssigned once the human has
 * actually made the move. Records the historic row and links it back.
 */
export async function promoteTouchpoint(id: string, formData: FormData) {
  await requireEmail();
  const [tp] = await db
    .select()
    .from(touchpointsPotential)
    .where(eq(touchpointsPotential.id, id));
  if (!tp) throw new Error("Touchpoint not found");
  if (tp.reviewStatus !== "approved")
    throw new Error("Only approved touchpoints can be promoted");

  const completedDate = String(formData.get("completedDate") ?? "").trim();
  const summary = String(formData.get("summary") ?? "").trim();
  const response = String(formData.get("response") ?? "").trim() || null;
  const nextStep = String(formData.get("nextStep") ?? "").trim() || null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(completedDate))
    throw new Error("completedDate must be YYYY-MM-DD");
  if (!summary) throw new Error("summary is required");

  const [assigned] = await db
    .insert(touchpointsAssigned)
    .values({
      prospectId: tp.prospectId,
      touchpointType: tp.touchpointType,
      completedDate,
      summary,
      response,
      nextStep,
    })
    .returning({ id: touchpointsAssigned.id });

  await db
    .update(touchpointsPotential)
    .set({ reviewStatus: "promoted", promotedToAssignedId: assigned.id })
    .where(eq(touchpointsPotential.id, id));

  revalidatePath("/admin/touchpoints");
}
