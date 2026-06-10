import { google, type docs_v1 } from "googleapis";

/**
 * Phase 1 n8n workflow used the agent's Google account to read per-prospect
 * "Context" Google Docs by file id. Re-using the Gmail OAuth client (same
 * `allard.prize.alerts@gmail.com` account) keeps env management simple — we
 * just need the Docs scope on the existing token.
 */
function getDocsClient() {
  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Missing Google OAuth env for Docs read: GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET, GMAIL_OAUTH_REFRESH_TOKEN"
    );
  }
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return google.docs({ version: "v1", auth: oauth2 });
}

export async function readGoogleDocsDossier(fileId: string): Promise<string> {
  const docs = getDocsClient();
  const res = await docs.documents.get({ documentId: fileId });
  return flattenDocBody(res.data);
}

function flattenDocBody(doc: docs_v1.Schema$Document): string {
  const lines: string[] = [];
  const content = doc.body?.content ?? [];
  for (const element of content) {
    const para = element.paragraph;
    if (!para) continue;
    let line = "";
    for (const el of para.elements ?? []) {
      const text = el.textRun?.content;
      if (text) line += text;
    }
    if (line.trim().length > 0) lines.push(line.replace(/\n$/, ""));
  }
  return lines.join("\n").trim();
}
