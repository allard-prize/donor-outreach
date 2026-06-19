/**
 * Generate the system README (.docx) and upload it to the root of the Allard
 * SharePoint folder (AP - Donor Outreach System). Explains, for a non-technical
 * user (Preet), how the system works: what she maintains vs. what the system
 * does each week.
 *
 *   pnpm tsx --env-file=.env.local scripts/upload-readme.ts          # build + upload
 *   pnpm tsx --env-file=.env.local scripts/upload-readme.ts --local  # write README.docx locally only
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
import {
  getStoredGraphToken,
} from "@/lib/msgraph/token-store";
import { resolveSharedItem, uploadFile } from "@/lib/msgraph/client";

const ROOT_FOLDER_URL =
  "https://allardprize2.sharepoint.com/:f:/r/sites/allardprize.org/Shared%20Documents/Shared%20Externally/AP%20-%20Donor%20Outreach%20System?csf=1&web=1&e=IdSKLK";
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const local = process.argv.includes("--local");

const h1 = (t: string) =>
  new Paragraph({ text: t, heading: HeadingLevel.HEADING_1, spacing: { after: 160 } });
const h2 = (t: string) =>
  new Paragraph({ text: t, heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } });
const p = (t: string) => new Paragraph({ children: [new TextRun(t)], spacing: { after: 120 } });
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
          h1("Donor Outreach System — How It Works"),
          p(
            "This system helps you keep track of key donors and prospects and decide when and how to reach out. You maintain a small amount of information; each week the system reviews everything and emails you a single digest with recommended actions. Most of your work happens in the dashboard, with prospect background documents kept in this OneDrive folder."
          ),

          h2("What you set up and maintain"),
          bullet(
            "Prospects",
            "The people and organizations you track. Add or edit them on the dashboard under Prospects (name, type, LinkedIn, which monitoring is enabled)."
          ),
          bullet(
            "Sources",
            "Where the system watches for news about each prospect — Google Alert / RSS feeds, the email inbox, and LinkedIn. Manage these on the dashboard under Sources."
          ),
          bullet(
            "Dossiers",
            "A one-page background document for each prospect, kept as a Word file in the Context subfolder of this OneDrive folder (named '<Full Name> - Summary.docx'). Edit these directly in Word/SharePoint; the system reads them when it assesses each prospect."
          ),
          bullet(
            "Touchpoints",
            "Your log of interactions that have already happened (a call, a meeting, an email). Record them on the dashboard under Touchpoints. The system feeds this history to the AI so its recommendations account for your relationship so far."
          ),

          h2("What the system does each week"),
          bullet(
            "Collects results",
            "It gathers new items from your sources (news, posts, emails) for each prospect. You can see these on the dashboard under Results."
          ),
          bullet(
            "Assesses each prospect",
            "The AI reads the new results, the prospect's dossier, and your logged touchpoints, then summarizes where the relationship stands and whether there's a timely reason to reach out. Every prospect's weekly assessment is on the dashboard under Assessments."
          ),
          bullet(
            "Sends one weekly digest",
            "You receive a single email summarizing all prospects. Prospects that warrant action are featured with a ready-to-adapt draft message; the rest appear in a short monitoring list. Each digest is saved on the dashboard under Briefings."
          ),

          h2("Your weekly routine"),
          p(
            "1. Read the weekly digest email. 2. For any featured prospect, use or adapt the suggested draft to reach out. 3. Open Assessments (or the prospect's page) if you want the full detail behind a recommendation. 4. After you act, log what you did under Touchpoints — that keeps the AI's future recommendations accurate."
          ),

          h2("Where things live"),
          bullet("Dashboard", "Prospects, Sources, Results, Assessments, Touchpoints, Briefings, and system Health."),
          bullet(
            "This OneDrive folder",
            "Prospect dossiers (in the Context subfolder) and this README. Everything else — the data you edit — lives in the dashboard."
          ),
        ],
      },
    ],
  });
}

async function main(): Promise<void> {
  const buffer = await Packer.toBuffer(buildDoc());
  const bytes = Buffer.from(buffer);
  console.log(`[readme] built README.docx (${(bytes.byteLength / 1024).toFixed(0)} KB)`);

  if (local) {
    writeFileSync("README.docx", bytes);
    console.log("[readme] wrote ./README.docx (local only)");
    return;
  }

  const token = await getStoredGraphToken();
  const folder = await resolveSharedItem(token, ROOT_FOLDER_URL);
  const driveId = folder.parentReference?.driveId;
  if (!driveId) throw new Error("resolved root folder has no driveId");
  console.log(`[readme] dest: ${folder.name ?? "(root)"} · ${folder.webUrl ?? ""}`);

  const up = await uploadFile(token, driveId, folder.id, "README.docx", bytes, DOCX_MIME);
  console.log(`[readme] uploaded README.docx → ${up.id}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[readme] failed", e instanceof Error ? e.message : e);
    process.exit(1);
  });
