/**
 * Phase 2G — durable Graph token store (Postgres).
 *
 * The delegated B2B-guest refresh token rotates on every redemption, which a
 * read-only serverless filesystem can't persist. This module keeps the current
 * refresh token in the `app_token` table: read it, redeem it, write the rotated
 * token back — all in Postgres, so the Vercel cron survives rotation.
 *
 * The access token is cached per-process so one cron invocation redeems (and
 * rotates) exactly once, no matter how many prospects it reads.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appTokens } from "@/lib/db/schema";
import { getGraphToken } from "@/lib/msgraph/client";

const TOKEN_KEY = "msgraph_dossier";

let cached: { token: string; expiresAt: number } | null = null;

async function readStoredRefreshToken(): Promise<string | null> {
  const rows = await db
    .select({ refreshToken: appTokens.refreshToken })
    .from(appTokens)
    .where(eq(appTokens.key, TOKEN_KEY));
  return rows[0]?.refreshToken ?? null;
}

async function writeStoredRefreshToken(token: string): Promise<void> {
  await db
    .insert(appTokens)
    .values({ key: TOKEN_KEY, refreshToken: token, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appTokens.key,
      set: { refreshToken: token, updatedAt: new Date() },
    });
}

/** Seed the store from the env refresh token (run once, locally, after the copy). */
export async function seedTokenStoreFromEnv(): Promise<void> {
  const token =
    process.env.MSGRAPH_REFRESH_TOKEN ?? process.env.ONEDRIVE_OAUTH_REFRESH_TOKEN;
  if (!token) {
    throw new Error("no MSGRAPH_/ONEDRIVE_OAUTH_REFRESH_TOKEN in env to seed the store");
  }
  await writeStoredRefreshToken(token);
}

/**
 * Get a Graph access token using the Postgres-held refresh token, persisting the
 * rotated token back to the store. Falls back to the env token if the store is
 * empty (first run before seeding). Cached per-process until shortly before expiry.
 */
export async function getStoredGraphToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const stored = await readStoredRefreshToken();
  const refreshToken = stored ?? process.env.ONEDRIVE_OAUTH_REFRESH_TOKEN ?? undefined;
  const res = await getGraphToken({ refreshToken, persistRefreshToken: writeStoredRefreshToken });
  cached = {
    token: res.accessToken,
    expiresAt: Date.now() + (res.expiresIn ?? 3600) * 1000,
  };
  return res.accessToken;
}
