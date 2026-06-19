"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { touchpointsAssigned } from "@/lib/db/schema";
import { touchpointTypeValues } from "@/lib/llm/schema";

async function requireEmail(): Promise<string> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) throw new Error("Unauthorized");
  return email;
}

// Assigned touchpoints are Preet's log of completed interactions — an INPUT fed
// to the agent. These actions let her maintain that log from the dashboard.
// (The Phase 1 "Potential" review queue was dropped in Phase 2G.)

type AssignedType = (typeof touchpointTypeValues)[number];

function parseForm(formData: FormData): {
  prospectId: string;
  touchpointType: AssignedType;
  completedDate: string;
  summary: string;
  response: string | null;
  nextStep: string | null;
} {
  const prospectId = String(formData.get("prospectId") ?? "").trim();
  const touchpointType = String(formData.get("touchpointType") ?? "").trim();
  const completedDate = String(formData.get("completedDate") ?? "").trim();
  const summary = String(formData.get("summary") ?? "").trim();
  const response = String(formData.get("response") ?? "").trim() || null;
  const nextStep = String(formData.get("nextStep") ?? "").trim() || null;

  if (!prospectId) throw new Error("prospect is required");
  if (!touchpointTypeValues.includes(touchpointType as AssignedType)) {
    throw new Error(`invalid touchpoint type: ${touchpointType}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(completedDate)) {
    throw new Error("completedDate must be YYYY-MM-DD");
  }
  if (!summary) throw new Error("summary is required");

  return {
    prospectId,
    touchpointType: touchpointType as AssignedType,
    completedDate,
    summary,
    response,
    nextStep,
  };
}

export async function upsertAssignedTouchpoint(formData: FormData) {
  await requireEmail();
  const id = String(formData.get("id") ?? "").trim();
  const values = parseForm(formData);

  if (id) {
    await db.update(touchpointsAssigned).set(values).where(eq(touchpointsAssigned.id, id));
  } else {
    await db.insert(touchpointsAssigned).values(values);
  }
  revalidatePath("/admin/touchpoints");
}

export async function deleteAssignedTouchpoint(id: string) {
  await requireEmail();
  if (!id) throw new Error("id is required");
  await db.delete(touchpointsAssigned).where(eq(touchpointsAssigned.id, id));
  revalidatePath("/admin/touchpoints");
}
