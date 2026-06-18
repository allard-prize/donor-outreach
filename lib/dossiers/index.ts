import { readGoogleDocsDossier } from "@/lib/dossiers/google-docs";
import { readSharePointDossier } from "@/lib/dossiers/onedrive";

export type DossierProvider = "google_docs" | "onedrive";

export type DossierFetchInput = {
  provider: DossierProvider | null | undefined;
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
  switch (input.provider) {
    case "google_docs":
      return readGoogleDocsDossier(input.fileId);
    case "onedrive":
      return readSharePointDossier(input.fileId, { accessToken: input.graphAccessToken });
    default: {
      const _exhaustive: never = input.provider;
      throw new Error(`Unknown dossierProvider: ${_exhaustive as string}`);
    }
  }
}
