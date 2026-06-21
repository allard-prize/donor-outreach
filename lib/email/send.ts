import { Buffer } from "node:buffer";
import { getGmailClient } from "@/lib/gmail/client";

/**
 * Send a UTF-8 HTML email from the agent's Gmail. Generic transport reused by
 * any non-digest sender (e.g. the weekly health-check). The digest path keeps
 * its own copy in send-briefing.ts for now; unify if a third caller appears.
 */
export async function sendGmailHtml(args: {
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
