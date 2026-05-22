import type { gmail_v1 } from "googleapis";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { prospects, results } from "@/lib/db/schema";
import { getGmailClient } from "@/lib/gmail/client";

export type GmailCaptureSummary = {
  prospectsChecked: number;
  prospectsWithLabel: number;
  messagesScanned: number;
  messagesInserted: number;
  messagesSkipped: number;
  inboxLabelsRemoved: number;
  prospectsFailed: { prospectId: string; fullName: string; error: string }[];
};

const MAX_MESSAGES_PER_PROSPECT = 100;
const TITLE_CAP = 500;
const SNIPPET_CAP = 4000;

export async function captureGmail(): Promise<GmailCaptureSummary> {
  const summary: GmailCaptureSummary = {
    prospectsChecked: 0,
    prospectsWithLabel: 0,
    messagesScanned: 0,
    messagesInserted: 0,
    messagesSkipped: 0,
    inboxLabelsRemoved: 0,
    prospectsFailed: [],
  };

  const eligible = await db
    .select({ id: prospects.id, fullName: prospects.fullName })
    .from(prospects)
    .where(and(eq(prospects.emailEnabled, true), isNull(prospects.archivedAt)));

  summary.prospectsChecked = eligible.length;
  if (eligible.length === 0) return summary;

  const gmail = getGmailClient();
  const labelByName = await loadLabelsByName(gmail);

  for (const prospect of eligible) {
    const labelId = labelByName.get(prospect.fullName.toLowerCase());
    if (!labelId) continue;
    summary.prospectsWithLabel += 1;

    try {
      await captureProspectMessages(gmail, prospect, labelId, summary);
    } catch (err) {
      summary.prospectsFailed.push({
        prospectId: prospect.id,
        fullName: prospect.fullName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}

async function loadLabelsByName(gmail: gmail_v1.Gmail): Promise<Map<string, string>> {
  const resp = await gmail.users.labels.list({ userId: "me" });
  const labels = resp.data.labels ?? [];
  const byName = new Map<string, string>();
  for (const label of labels) {
    if (label.name && label.id) {
      byName.set(label.name.toLowerCase(), label.id);
    }
  }
  return byName;
}

async function captureProspectMessages(
  gmail: gmail_v1.Gmail,
  prospect: { id: string; fullName: string },
  labelId: string,
  summary: GmailCaptureSummary
): Promise<void> {
  const listResp = await gmail.users.messages.list({
    userId: "me",
    labelIds: ["INBOX", labelId],
    maxResults: MAX_MESSAGES_PER_PROSPECT,
  });
  const messages = listResp.data.messages ?? [];
  summary.messagesScanned += messages.length;

  for (const ref of messages) {
    if (!ref.id) continue;

    const full = await gmail.users.messages.get({
      userId: "me",
      id: ref.id,
      format: "full",
    });

    const row = buildResultRow(prospect.id, ref.id, full.data);
    const inserted = await db
      .insert(results)
      .values(row)
      .onConflictDoNothing({ target: results.id })
      .returning({ id: results.id });

    if (inserted.length > 0) summary.messagesInserted += 1;
    else summary.messagesSkipped += 1;

    // Strip INBOX so the next run doesn't re-scan this message — Phase 1 invariant.
    // The donor label stays for historical reference.
    await gmail.users.messages.modify({
      userId: "me",
      id: ref.id,
      requestBody: { removeLabelIds: ["INBOX"] },
    });
    summary.inboxLabelsRemoved += 1;
  }
}

function buildResultRow(
  prospectId: string,
  messageId: string,
  message: gmail_v1.Schema$Message
) {
  const headers = message.payload?.headers ?? [];
  const subject =
    headers.find((h) => h.name?.toLowerCase() === "subject")?.value ?? "(no subject)";
  const dateHeader = headers.find((h) => h.name?.toLowerCase() === "date")?.value;

  let pubDate: Date;
  if (dateHeader) {
    const parsed = new Date(dateHeader);
    pubDate = Number.isNaN(parsed.getTime())
      ? new Date(Number(message.internalDate ?? Date.now()))
      : parsed;
  } else if (message.internalDate) {
    pubDate = new Date(Number(message.internalDate));
  } else {
    pubDate = new Date();
  }

  const bodyText = extractBodyText(message.payload) || message.snippet || "";

  return {
    id: messageId,
    sourceId: null,
    prospectId,
    sourceType: "email" as const,
    title: subject.slice(0, TITLE_CAP),
    link: null,
    pubDate,
    contentSnippet: bodyText.slice(0, SNIPPET_CAP),
    processedStatus: "pending" as const,
  };
}

function extractBodyText(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  const plain = findPart(payload.parts ?? [], "text/plain");
  if (plain?.body?.data) return decodeBase64Url(plain.body.data);
  const html = findPart(payload.parts ?? [], "text/html");
  if (html?.body?.data) return decodeBase64Url(html.body.data);
  return "";
}

function findPart(
  parts: gmail_v1.Schema$MessagePart[],
  mimeType: string
): gmail_v1.Schema$MessagePart | undefined {
  for (const part of parts) {
    if (part.mimeType === mimeType && part.body?.data) return part;
    if (part.parts) {
      const inner = findPart(part.parts, mimeType);
      if (inner) return inner;
    }
  }
  return undefined;
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
}
