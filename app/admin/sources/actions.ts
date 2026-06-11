"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { sources } from "@/lib/db/schema";

async function requireSession() {
  const session = await auth();
  if (!session?.user?.email) throw new Error("Unauthorized");
  return session;
}

export async function createSource(formData: FormData) {
  await requireSession();
  const prospectId = String(formData.get("prospectId") ?? "").trim();
  const rssUrl = String(formData.get("rssUrl") ?? "").trim();
  if (!prospectId || !rssUrl) throw new Error("prospectId and rssUrl are required");
  let parsed: URL;
  try {
    parsed = new URL(rssUrl);
  } catch {
    throw new Error("rssUrl is not a valid URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol))
    throw new Error("rssUrl must be http(s)");
  await db.insert(sources).values({ prospectId, rssUrl });
  revalidatePath("/admin/sources");
}

export async function disableSource(id: string) {
  await requireSession();
  await db
    .update(sources)
    .set({ disabledAt: sql`now()` })
    .where(eq(sources.id, id));
  revalidatePath("/admin/sources");
}

export async function enableSource(id: string) {
  await requireSession();
  await db.update(sources).set({ disabledAt: null }).where(eq(sources.id, id));
  revalidatePath("/admin/sources");
}
