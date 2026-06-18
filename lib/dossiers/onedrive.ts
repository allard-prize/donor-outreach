/**
 * Phase 2G — read a per-prospect dossier from the Allard SharePoint library.
 *
 * `dossierFileId` convention for the `onedrive` provider: `"<driveId>:<itemId>"`
 * (all dossiers live in one drive, but storing the driveId per row keeps the
 * reference self-contained). The file is a Word `.docx`; mammoth extracts text.
 *
 * Token acquisition defaults to the durable Postgres token store
 * (lib/msgraph/token-store.ts), which redeems the delegated B2B-guest refresh
 * token and persists the rotated token — serverless-safe. The store caches the
 * access token per-process, so one cron run redeems once for all prospects.
 * Callers may still pass `opts.accessToken` to reuse a token they already hold.
 */
import { Buffer } from "node:buffer";
import mammoth from "mammoth";
import { graphFetch } from "@/lib/msgraph/client";
import { getStoredGraphToken } from "@/lib/msgraph/token-store";

export function parseDossierRef(fileRef: string): { driveId: string | null; itemId: string } {
  const idx = fileRef.indexOf(":");
  if (idx === -1) return { driveId: null, itemId: fileRef };
  return { driveId: fileRef.slice(0, idx), itemId: fileRef.slice(idx + 1) };
}

export async function readSharePointDossier(
  fileRef: string,
  opts: { accessToken?: string } = {}
): Promise<string> {
  const { driveId, itemId } = parseDossierRef(fileRef);
  if (!driveId) {
    throw new Error(
      `onedrive dossierFileId must be "<driveId>:<itemId>", got "${fileRef.slice(0, 40)}"`
    );
  }

  const token = opts.accessToken ?? (await getStoredGraphToken());

  const res = await graphFetch(token, `/drives/${driveId}/items/${itemId}/content`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`SharePoint dossier read ${itemId} → ${res.status}: ${text.slice(0, 200)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const { value } = await mammoth.extractRawText({ buffer: buf });
  return value.trim();
}
