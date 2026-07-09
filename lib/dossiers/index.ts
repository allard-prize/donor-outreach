import { readSharePointDossier } from "@/lib/dossiers/onedrive";

// google_docs was retired at the Phase 2G cutover; the DB enum still carries the
// value (Postgres enum values are effectively permanent) but no writer sets it.
export type DossierProvider = "onedrive";

export type DossierFetchInput = {
  provider: string | null | undefined;
  fileId: string | null | undefined;
  // Optional pre-acquired Graph access token — acquire once per cron run for the
  // onedrive/SharePoint provider rather than redeeming the token per prospect.
  graphAccessToken?: string;
};

/**
 * Provider dispatcher. Returns the dossier text or an empty string when no
 * dossier is configured for the prospect. Throws on provider-level errors so
 * the cron handler can record `partial` for that prospect.
 */
export async function getDossierText(input: DossierFetchInput): Promise<string> {
  if (!input.provider || !input.fileId) return "";
  if (input.provider !== "onedrive") {
    throw new Error(`Unsupported dossierProvider: ${input.provider}`);
  }
  return readSharePointDossier(input.fileId, { accessToken: input.graphAccessToken });
}
