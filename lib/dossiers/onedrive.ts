/**
 * Phase 2G — read a per-prospect dossier from the Allard SharePoint library.
 *
 * `dossierFileId` convention for the `onedrive` provider: `"<driveId>:<itemId>"`
 * (all dossiers live in one drive, but storing the driveId per row keeps the
 * reference self-contained). The file is a Word `.docx`; mammoth extracts text.
 *
 * Token acquisition uses the delegated B2B-guest refresh token. Within a single
 * cron run, acquire one access token and pass it in via `opts.accessToken` so we
 * redeem (and rotate) the refresh token once per run, not once per prospect.
 * Serverless rotation persistence is the open production item — see the spec 2G
 * Open Questions (Postgres token store vs the app-only Sites.Selected grant).
 */
import { Buffer } from "node:buffer";
import mammoth from "mammoth";
import { getGraphToken, graphFetch } from "@/lib/msgraph/client";

export function parseDossierRef(fileRef: string): { driveId: string | null; itemId: string } {
  const idx = fileRef.indexOf(":");
  if (idx === -1) return { driveId: null, itemId: fileRef };
  return { driveId: fileRef.slice(0, idx), itemId: fileRef.slice(idx + 1) };
}

export async function readSharePointDossier(
  fileRef: string,
  opts: {
    accessToken?: string;
    persistRefreshToken?: (token: string) => Promise<void>;
  } = {}
): Promise<string> {
  const { driveId, itemId } = parseDossierRef(fileRef);
  if (!driveId) {
    throw new Error(
      `onedrive dossierFileId must be "<driveId>:<itemId>", got "${fileRef.slice(0, 40)}"`
    );
  }

  const token =
    opts.accessToken ??
    (await getGraphToken({ persistRefreshToken: opts.persistRefreshToken })).accessToken;

  const res = await graphFetch(token, `/drives/${driveId}/items/${itemId}/content`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`SharePoint dossier read ${itemId} → ${res.status}: ${text.slice(0, 200)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const { value } = await mammoth.extractRawText({ buffer: buf });
  return value.trim();
}
