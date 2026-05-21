import { auth } from "@/auth";
import { db } from "@/lib/db";
import { prospects } from "@/lib/db/schema";
import { isNull, count } from "drizzle-orm";

export default async function AdminHomePage() {
  const session = await auth();
  const [{ value: prospectCount }] = await db
    .select({ value: count() })
    .from(prospects)
    .where(isNull(prospects.deletedAt));

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">Hello {session?.user?.name ?? "there"}</h1>
      <p className="mt-4 text-sm text-gray-600">
        Signed in as {session?.user?.email}.
      </p>
      <p className="mt-2 text-sm text-gray-600">
        Active prospects in database: {prospectCount}
      </p>
    </main>
  );
}
