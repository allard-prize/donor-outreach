/**
 * Phase 2G — Microsoft Graph client (Allard Prize SharePoint tenant).
 *
 * Auth model is the delegated device-flow token captured for a real Entra B2B
 * guest in the Allard tenant. Per klaus memory reference_msgraph_client_tenant_gotchas:
 *  - redeem the refresh token as a PUBLIC client — NO client_secret (else AADSTS700025)
 *  - scope MUST be `https://graph.microsoft.com/.default` (named scopes re-trigger
 *    the admin-consent wall)
 *  - Microsoft ROTATES the refresh token on every redemption — persist the new one
 *  - resolve SharePoint folders via the shares API, not /me/drive/sharedWithMe
 *
 * Env: ONEDRIVE_OAUTH_* (current) or MSGRAPH_* (post-rename). Both accepted.
 *
 * Token rotation note: in a local script we persist the rotated refresh token back
 * to .env.local. The Vercel cron reader needs a durable token store (Postgres) OR
 * the app-only Sites.Selected grant (preferred, removes rotation entirely) — see
 * the spec 2G Open Questions. Not solved here; this client serves the migration +
 * a read path that works once a valid refresh token is present.
 */
import { Buffer } from "node:buffer";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

function env(name: string): string | undefined {
  return process.env[`MSGRAPH_${name}`] ?? process.env[`ONEDRIVE_OAUTH_${name}`];
}

export type TokenResult = { accessToken: string; refreshToken?: string; expiresIn?: number };

/**
 * Redeem a refresh token for a Graph access token. Uses `opts.refreshToken`
 * when given (the durable token store passes the Postgres-held token), else the
 * env value. Calls `persistRefreshToken` with the rotated token when one comes
 * back (Microsoft rotates on every redemption).
 */
export async function getGraphToken(opts?: {
  refreshToken?: string;
  persistRefreshToken?: (token: string) => Promise<void>;
}): Promise<TokenResult> {
  const tenant = env("TENANT_ID");
  const clientId = env("CLIENT_ID");
  const refreshToken = opts?.refreshToken ?? env("REFRESH_TOKEN");
  if (!tenant || !clientId || !refreshToken) {
    throw new Error(
      "Missing Graph OAuth: need a refresh token + ONEDRIVE_OAUTH_TENANT_ID / _CLIENT_ID (or MSGRAPH_*)"
    );
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: refreshToken,
    scope: "https://graph.microsoft.com/.default",
    // Intentionally NO client_secret — public-client device-flow token.
  });

  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    // Surface the AADSTS code (but not the token) for diagnosis.
    throw new Error(
      `Graph token redemption failed (${res.status}): ${json.error ?? ""} ${(
        json.error_description ?? ""
      ).slice(0, 240)}`
    );
  }
  if (json.refresh_token && opts?.persistRefreshToken) {
    await opts.persistRefreshToken(json.refresh_token);
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in,
  };
}

export async function graphFetch(
  token: string,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const url = path.startsWith("http") ? path : `${GRAPH_BASE}${path}`;
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
}

async function graphJson<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await graphFetch(token, path, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Graph ${init?.method ?? "GET"} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export type DriveItem = {
  id: string;
  name?: string;
  webUrl?: string;
  size?: number;
  parentReference?: { driveId?: string; id?: string };
  folder?: { childCount?: number };
  file?: { mimeType?: string };
};

/** base64url with no padding, per the Graph shares API encoding rule. */
export function encodeShareUrl(url: string): string {
  const b64 = Buffer.from(url, "utf8").toString("base64");
  return "u!" + b64.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** Resolve a SharePoint sharing URL to its driveItem (robust folder addressing). */
export async function resolveSharedItem(token: string, shareUrl: string): Promise<DriveItem> {
  return graphJson<DriveItem>(token, `/shares/${encodeShareUrl(shareUrl)}/driveItem`);
}

/** List children of a folder drive-item. */
export async function listChildren(
  token: string,
  driveId: string,
  itemId: string
): Promise<DriveItem[]> {
  const out: DriveItem[] = [];
  let next: string | undefined = `/drives/${driveId}/items/${itemId}/children?$top=200`;
  while (next) {
    const page: { value: DriveItem[]; "@odata.nextLink"?: string } = await graphJson(token, next);
    out.push(...page.value);
    next = page["@odata.nextLink"];
  }
  return out;
}

/**
 * Upload bytes to `<folder>/<name>` via simple PUT (<4 MB) or a chunked upload
 * session (larger). Overwrites on name conflict (`@microsoft.graph.conflictBehavior`).
 */
export async function uploadFile(
  token: string,
  driveId: string,
  folderItemId: string,
  name: string,
  bytes: Buffer,
  contentType: string
): Promise<DriveItem> {
  const SIMPLE_LIMIT = 4 * 1024 * 1024;
  const safeName = encodeURIComponent(name);

  if (bytes.byteLength <= SIMPLE_LIMIT) {
    return graphJson<DriveItem>(
      token,
      `/drives/${driveId}/items/${folderItemId}:/${safeName}:/content?@microsoft.graph.conflictBehavior=replace`,
      { method: "PUT", headers: { "Content-Type": contentType }, body: new Uint8Array(bytes) }
    );
  }

  const session = await graphJson<{ uploadUrl: string }>(
    token,
    `/drives/${driveId}/items/${folderItemId}:/${safeName}:/createUploadSession`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } }),
    }
  );

  const CHUNK = 5 * 1024 * 1024;
  let start = 0;
  let last: DriveItem | null = null;
  while (start < bytes.byteLength) {
    const end = Math.min(start + CHUNK, bytes.byteLength);
    const chunk = bytes.subarray(start, end);
    const res = await fetch(session.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(chunk.byteLength),
        "Content-Range": `bytes ${start}-${end - 1}/${bytes.byteLength}`,
      },
      body: new Uint8Array(chunk),
    });
    if (!res.ok && res.status !== 202) {
      const text = await res.text().catch(() => "");
      throw new Error(`upload chunk ${start}-${end} → ${res.status}: ${text.slice(0, 200)}`);
    }
    if (res.status !== 202) last = (await res.json()) as DriveItem;
    start = end;
  }
  if (!last) throw new Error("upload session completed without a final driveItem");
  return last;
}
