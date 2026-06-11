"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { prospects, profileType } from "@/lib/db/schema";

const PROFILE_TYPES = profileType.enumValues;

async function requireSession() {
  const session = await auth();
  if (!session?.user?.email) throw new Error("Unauthorized");
  return session;
}

function parseProspectForm(formData: FormData) {
  const fullName = String(formData.get("fullName") ?? "").trim();
  const pt = String(formData.get("profileType") ?? "unknown");
  const linkedInUrl = String(formData.get("linkedInUrl") ?? "").trim() || null;
  const dossierFileId = String(formData.get("dossierFileId") ?? "").trim() || null;
  if (!fullName) throw new Error("fullName is required");
  if (!PROFILE_TYPES.includes(pt as (typeof PROFILE_TYPES)[number]))
    throw new Error(`invalid profileType: ${pt}`);
  return {
    fullName,
    profileType: pt as (typeof PROFILE_TYPES)[number],
    linkedInUrl,
    emailEnabled: formData.get("emailEnabled") === "on",
    linkedInEnabled: formData.get("linkedInEnabled") === "on",
    dossierFileId,
    // Provider stays google_docs until Phase 2G cutover; only set when a file id exists.
    dossierProvider: dossierFileId ? ("google_docs" as const) : null,
  };
}

export async function createProspect(formData: FormData) {
  await requireSession();
  const values = parseProspectForm(formData);
  await db.insert(prospects).values(values);
  revalidatePath("/admin/prospects");
  redirect("/admin/prospects");
}

export async function updateProspect(id: string, formData: FormData) {
  await requireSession();
  const values = parseProspectForm(formData);
  await db
    .update(prospects)
    .set({ ...values, updatedAt: sql`now()` })
    .where(eq(prospects.id, id));
  revalidatePath("/admin/prospects");
  redirect("/admin/prospects");
}

export async function archiveProspect(id: string) {
  await requireSession();
  await db
    .update(prospects)
    .set({ archivedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(prospects.id, id));
  revalidatePath("/admin/prospects");
}

export async function restoreProspect(id: string) {
  await requireSession();
  await db
    .update(prospects)
    .set({ archivedAt: null, updatedAt: sql`now()` })
    .where(eq(prospects.id, id));
  revalidatePath("/admin/prospects");
}
