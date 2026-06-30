/**
 * Generate the "Making Changes — Maintenance Guide" (.docx) and upload it to the
 * root of the Allard SharePoint folder (AP - Donor Outreach System), alongside
 * README.docx. This is the human companion to the in-repo AGENTS.md runbook: it
 * tells the non-technical operator (Preet) how to evolve the system by talking to
 * ChatGPT — no code, no GitHub. Pairs with the dashboard's "Make a change" page.
 *
 *   pnpm tsx --env-file=.env.local scripts/upload-maintenance-guide.ts          # build + upload
 *   pnpm tsx --env-file=.env.local scripts/upload-maintenance-guide.ts --local  # write the .docx locally only
 */
import { writeFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { getStoredGraphToken } from "@/lib/msgraph/token-store";
import { resolveSharedItem, uploadFile } from "@/lib/msgraph/client";

const ROOT_FOLDER_URL =
  "https://allardprize2.sharepoint.com/:f:/r/sites/allardprize.org/Shared%20Documents/Shared%20Externally/AP%20-%20Donor%20Outreach%20System?csf=1&web=1&e=IdSKLK";
const FILE_NAME = "Making Changes - Maintenance Guide.docx";
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const local = process.argv.includes("--local");

const h1 = (t: string) =>
  new Paragraph({ text: t, heading: HeadingLevel.HEADING_1, spacing: { after: 160 } });
const h2 = (t: string) =>
  new Paragraph({ text: t, heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } });
const p = (t: string) => new Paragraph({ children: [new TextRun(t)], spacing: { after: 120 } });
const step = (n: number, label: string, body: string) =>
  new Paragraph({
    spacing: { after: 120 },
    children: [
      new TextRun({ text: `${n}. ${label} — `, bold: true }),
      new TextRun(body),
    ],
  });
const bullet = (label: string, body: string) =>
  new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 80 },
    children: [new TextRun({ text: `${label} — `, bold: true }), new TextRun(body)],
  });

function buildDoc(): Document {
  return new Document({
    sections: [
      {
        children: [
          h1("Making Changes — Maintenance Guide"),
          p(
            "You can change this system yourself by having a conversation with ChatGPT — no code, no developer. You describe what you want, ChatGPT prepares the change, and you preview and publish it with a couple of clicks. Here is the whole process."
          ),

          h2("The three steps"),
          step(
            1,
            "Ask for the change",
            "Open ChatGPT and describe what you want in plain English — for example, “Add the priority score to the weekly digest email.” ChatGPT makes the change for you. (On the dashboard, the “Make a change” page has a button that opens ChatGPT for you.)"
          ),
          step(
            2,
            "Open it on GitHub",
            "When ChatGPT finishes, it shows a green button to open your change on GitHub. Click it. GitHub is simply where you preview and approve changes — you only need two buttons there, and this guide points them out. You don’t need to understand anything else on the page."
          ),
          step(
            3,
            "Preview, then publish",
            "On the GitHub page, click the preview link to see your change on a private copy of the system — nothing is live yet. If it looks right, click the green “Merge” button to publish it and make it live. (If the page says your change is a “draft,” click “Ready for review” first, then the green Merge button.) If it’s not right, go back to ChatGPT and tell it what to fix — it will prepare a new version for you to preview."
          ),
          p(
            "That’s it. You never write any code. The only technical-looking step is clicking the green button on GitHub to publish — everything else is just describing what you want to ChatGPT."
          ),

          h2("Things you can ask for"),
          bullet("Wording", "Change the wording or layout of the weekly digest email, or which details it shows."),
          bullet("Dashboard", "Rename a label, add a column, change the order or filtering of a list."),
          bullet("Thresholds", "Adjust how high a prospect’s priority score must be before it’s flagged as an alert."),
          bullet("Categories", "Add or rename a prospect type or a kind of touchpoint."),
          bullet("New information", "Start tracking a new piece of information about prospects (for example, a LinkedIn URL)."),

          h2("Check with Brian first"),
          p("A few things are best left to Brian. If you want to change any of these, email him rather than asking ChatGPT:"),
          bullet("Who can sign in", "Adding or removing people who can log in to the dashboard."),
          bullet("Passwords and keys", "Anything involving passwords, security keys, or the monthly spending limit."),
          bullet("The schedule", "When the system runs each week."),
          bullet("Removing information", "Deleting a column or a whole category (removing things is riskier than adding)."),

          h2("If something looks wrong"),
          p(
            "Nothing you do here can quietly break things: every change is previewed before it goes live, and you are the one who clicks the green Merge button to publish — so nothing reaches the real system until you approve it. Want to undo something that’s already live? Ask ChatGPT to undo it, then publish that change the same way (open it on GitHub and click Merge). You also get a short health email each week confirming the system is running. If a change doesn’t go the way you expected, or ChatGPT seems stuck, email Brian — he can always step in."
          ),

          h2("A tip"),
          p(
            "Be specific. “In the weekly digest email, show each prospect’s priority score next to their name” works better than “make the email better.” If you’re not sure how to phrase it, just describe the problem and let ChatGPT suggest options."
          ),

          h2("Where things live"),
          bullet("Dashboard", "Where you do your day-to-day work and start changes (the “Make a change” page)."),
          bullet("This folder", "The README explains how the system works week to week; this guide is about changing it. Prospect dossiers live in the Context subfolder."),
        ],
      },
    ],
  });
}

async function main(): Promise<void> {
  const buffer = await Packer.toBuffer(buildDoc());
  const bytes = Buffer.from(buffer);
  console.log(`[guide] built "${FILE_NAME}" (${(bytes.byteLength / 1024).toFixed(0)} KB)`);

  if (local) {
    writeFileSync(FILE_NAME, bytes);
    console.log(`[guide] wrote ./${FILE_NAME} (local only)`);
    return;
  }

  const token = await getStoredGraphToken();
  const folder = await resolveSharedItem(token, ROOT_FOLDER_URL);
  const driveId = folder.parentReference?.driveId;
  if (!driveId) throw new Error("resolved root folder has no driveId");
  console.log(`[guide] dest: ${folder.name ?? "(root)"} · ${folder.webUrl ?? ""}`);

  const up = await uploadFile(token, driveId, folder.id, FILE_NAME, bytes, DOCX_MIME);
  console.log(`[guide] uploaded "${FILE_NAME}" → ${up.id}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[guide] failed", e instanceof Error ? e.message : e);
    process.exit(1);
  });
