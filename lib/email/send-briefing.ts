import { db } from "@/lib/db";
import { briefings } from "@/lib/db/schema";
import { getGmailClient } from "@/lib/gmail/client";
import {
  buildDigestSubject,
  isActionable,
  renderDigestHtml,
  type DigestEntry,
} from "@/lib/email/render-digest";

export type SendDigestInput = {
  cronRunId: string | null;
  entries: DigestEntry[];
  alertThreshold: number;
  runDate: string;
  recipients: string[];
  llmCostUsd: number;
  llmCallCount: number;
};

export type SendBriefingResult = {
  briefingId: string;
  status: "sent" | "failed";
  alertCount: number;
  errorMessage?: string;
};

/**
 * Send the single weekly digest email (one per run) and record one briefings
 * row. Featured (actionable) prospects render with the full per-prospect layout
 * + draft; the rest appear in a compact monitoring table.
 */
export async function sendWeeklyDigest(
  input: SendDigestInput
): Promise<SendBriefingResult> {
  const alertCount = input.entries.filter((e) =>
    isActionable(e, input.alertThreshold)
  ).length;
  const subject = buildDigestSubject(input.runDate, alertCount);
  const htmlBody = renderDigestHtml({
    entries: input.entries,
    alertThreshold: input.alertThreshold,
    runDate: input.runDate,
    generatedAt: new Date(),
  });

  const common = {
    cronRunId: input.cronRunId,
    recipients: input.recipients,
    prospectCount: input.entries.length,
    alertCount,
    subject,
    htmlBody,
    llmCostUsd: input.llmCostUsd,
    llmCallCount: input.llmCallCount,
  };

  if (input.recipients.length === 0) {
    return persistBriefing({
      ...common,
      status: "failed",
      errorMessage: "No briefing recipients configured (BRIEFING_RECIPIENTS).",
    });
  }

  try {
    await sendGmailHtml({
      from: "allard.prize.alerts@gmail.com",
      to: input.recipients,
      subject,
      htmlBody,
    });
    return persistBriefing({ ...common, status: "sent" });
  } catch (err) {
    return persistBriefing({
      ...common,
      status: "failed",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Record a sentinel briefing row when a weekly run produces zero high-priority
 * alerts (no email sent). Keeps the audit trail complete so absence of a
 * Tuesday briefing row signals broken cron, not a quiet week.
 */
export async function recordEmptyBriefing(args: {
  cronRunId: string | null;
  recipients: string[];
  prospectCount: number;
  llmCostUsd: number;
  llmCallCount: number;
}): Promise<string> {
  const [row] = await db
    .insert(briefings)
    .values({
      cronRunId: args.cronRunId,
      recipients: args.recipients,
      prospectCount: args.prospectCount,
      alertCount: 0,
      htmlBody: "",
      subject: "",
      llmCostUsd: args.llmCostUsd.toFixed(4),
      llmCallCount: args.llmCallCount,
      status: "sent",
    })
    .returning({ id: briefings.id });
  return row.id;
}

async function persistBriefing(args: {
  cronRunId: string | null;
  recipients: string[];
  prospectCount: number;
  alertCount: number;
  subject: string;
  htmlBody: string;
  llmCostUsd: number;
  llmCallCount: number;
  status: "sent" | "failed";
  errorMessage?: string;
}): Promise<SendBriefingResult> {
  const [row] = await db
    .insert(briefings)
    .values({
      cronRunId: args.cronRunId,
      recipients: args.recipients,
      prospectCount: args.prospectCount,
      alertCount: args.alertCount,
      htmlBody: args.htmlBody,
      subject: args.subject,
      llmCostUsd: args.llmCostUsd.toFixed(4),
      llmCallCount: args.llmCallCount,
      status: args.status,
      errorMessage: args.errorMessage,
    })
    .returning({ id: briefings.id });
  return {
    briefingId: row.id,
    status: args.status,
    alertCount: args.alertCount,
    errorMessage: args.errorMessage,
  };
}

async function sendGmailHtml(args: {
  from: string;
  to: string[];
  subject: string;
  htmlBody: string;
}): Promise<void> {
  const gmail = getGmailClient();
  const mime = buildHtmlMime(args);
  const encoded = Buffer.from(mime, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encoded },
  });
}

function buildHtmlMime(args: {
  from: string;
  to: string[];
  subject: string;
  htmlBody: string;
}): string {
  // RFC 5322 MIME body — UTF-8 HTML.
  const headers = [
    `From: ${args.from}`,
    `To: ${args.to.join(", ")}`,
    `Subject: =?UTF-8?B?${Buffer.from(args.subject, "utf8").toString("base64")}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: 8bit`,
  ];
  return `${headers.join("\r\n")}\r\n\r\n${args.htmlBody}`;
}

export function parseRecipientsEnv(): string[] {
  const raw = process.env.BRIEFING_RECIPIENTS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
