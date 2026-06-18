/**
 * Phase 2E — curated eval cases (synthetic, no PII).
 *
 * Each case carries the agent input payload plus the Phase 1 rubric machinery:
 * a `binaryChecks` array (deterministic 6-kind battery) and `rubric` questions
 * (binary "did this violate?" prompts for the LLM judge). All names/orgs here
 * are fictional — the repo may be public, and the real 1261-row Phase 1 dataset
 * (real prospect PII) stays in Google Sheets. `scripts/seed-eval-cases.ts`
 * loads these by default and can optionally pull the historical Sheet rows.
 *
 * These cases are the live-runner dataset. The deterministic judge logic is
 * unit-tested separately (lib/llm/__tests__/judge.test.ts) with inline vectors;
 * here the checks encode per-scenario expectations the model output must meet.
 */
import type { BinaryCheck } from "@/lib/llm/judge";

export type RubricQuestion = { question_id: string; question: string };

export type CuratedEvalCase = {
  label: string;
  promptVersion: string;
  input: {
    fullName: string;
    contextText: string;
    results: unknown[];
    touchpoints: unknown[];
  };
  binaryChecks: BinaryCheck[];
  rubric: RubricQuestion[];
  expectedBehavior: string;
};

// Reusable checks — universal Phase 1 invariants safe for every case.
// The contract validator already covers structure/enums/priority-draft
// invariants, so these add coverage *beyond* the contract:
//  - grounding: proper nouns in the rationale must trace to the input
//  - the "Why now:" prefix (Phase 1 enforced this as a binary check, not in
//    the contract) — only valid for action cases, so it is attached per-case.
const groundingCheck: BinaryCheck = {
  check_id: "rationale-grounded",
  kind: "cross-reference",
  source_field: "potential_touchpoint.engagement_rationale",
  context_fields: ["input.results", "input.contextText"],
  stoplist: ["Why Now", "Allard Prize"],
};

// Conditional "Why now:" prefix: the prompt only requires it when the
// touchpoint is an action (type != no_action). Expressed as an invariant so a
// legitimate no_action output is exempt — an unconditional regex would false-
// positive whenever the model correctly declines outreach. (The invariant
// runner prefixes dotted paths with `o.`; method calls after `()` are left
// alone, so `.indexOf(...)` survives the rewrite.)
const whyNowCheck: BinaryCheck = {
  check_id: "why-now-prefix",
  kind: "invariant",
  rule: "potential_touchpoint.touchpoint_type === 'no_action' || potential_touchpoint.engagement_rationale.toLowerCase().indexOf('why now') === 0",
};

const noActionInvariant: BinaryCheck = {
  check_id: "low-score-no-action",
  kind: "invariant",
  rule: 'potential_touchpoint.priority_score > 7 || potential_touchpoint.touchpoint_type === "no_action"',
};

// Shared rubric for action cases.
const actionRubric: RubricQuestion[] = [
  {
    question_id: "fabrication",
    question:
      "Does the draft_content or engagement_rationale invent facts (events, quotes, affiliations) that do not appear in the input results or context?",
  },
  {
    question_id: "tone",
    question:
      "Is the draft_content's tone inappropriate for a high-level donor relationship (overly salesy, presumptuous, or generic)?",
  },
  {
    question_id: "actionability",
    question:
      "Does the engagement_rationale fail to give a concrete, time-relevant reason ('why now') tied to a specific signal in the input?",
  },
];

const noActionRubric: RubricQuestion[] = [
  {
    question_id: "over-eager",
    question:
      "Given weak or stale signals, does the output recommend active outreach (priority_score >= 8 / a non-no_action touchpoint) when monitoring-only is the correct call?",
  },
  {
    question_id: "fabrication",
    question:
      "Does the monitoring summary invent activity or alerts not present in the input results?",
  },
];

export const CURATED_EVAL_CASES: CuratedEvalCase[] = [
  {
    label: "warm-contact-award-congratulations",
    promptVersion: "v1",
    input: {
      fullName: "Jordan Avery",
      contextText:
        "Institutional funder. Program director at the fictional Meridian Justice Foundation. Active, warm relationship — met the Allard Prize team at a 2025 governance forum, exchanged emails twice, and replied positively to a prior note. Strong mission alignment with anti-corruption work.",
      results: [
        {
          alert_source: "google_alert",
          title: "Meridian Justice Foundation names Jordan Avery to lead its Rule of Law program",
          content_summary:
            "Jordan Avery will direct the new Rule of Law program at Meridian Justice Foundation, focusing on judicial independence.",
          link: "https://example.org/news/meridian-avery",
          pubDate: "2026-06-14",
        },
      ],
      touchpoints: [
        {
          touchpoint_type: "content_sharing",
          completed_date: "2026-02-10",
          summary: "Shared an Allard Prize report on judicial independence; Jordan Avery replied warmly.",
        },
      ],
    },
    binaryChecks: [groundingCheck, whyNowCheck],
    rubric: actionRubric,
    expectedBehavior:
      "A fresh, dated, mission-aligned appointment on top of an existing warm relationship with a real access path is a clear opening. Expect a high priority_score (>=8), a congratulations-type touchpoint, a 'Why now:' rationale referencing the appointment, and a brief, warm draft grounded in the input.",
  },
  {
    label: "stale-no-signal-monitor-only",
    promptVersion: "v1",
    input: {
      fullName: "Priya Nandakumar",
      contextText:
        "Individual donor. Gave once two years ago. No recent interaction. Dormant relationship.",
      results: [
        {
          alert_source: "linkedin",
          title: "Reposted an industry article",
          content_summary: "Shared a generic article on philanthropy trends with no comment.",
          link: "https://example.org/li/repost",
          pubDate: "2026-06-10",
        },
      ],
      touchpoints: [],
    },
    binaryChecks: [noActionInvariant],
    rubric: noActionRubric,
    expectedBehavior:
      "A low-signal repost from a dormant contact does not warrant outreach. Expect priority_score <= 7, touchpoint_type 'no_action', and the placeholder draft.",
  },
  {
    label: "connector-intro-opportunity",
    promptVersion: "v1",
    input: {
      fullName: "Dr. Samuel Okonkwo",
      contextText:
        "Connector / credibility node. Sits on two foundation boards. Previously made a warm introduction. Active relationship.",
      results: [
        {
          alert_source: "email",
          title: "Reply: happy to connect you with the Halvorsen Trust",
          content_summary:
            "Dr. Okonkwo offered to introduce the Allard Prize team to a program officer at the Halvorsen Trust next month.",
          link: "",
          pubDate: "2026-06-15",
        },
      ],
      touchpoints: [
        {
          touchpoint_type: "introduction",
          completed_date: "2026-03-02",
          summary: "Introduced AP team to a partner organization.",
        },
      ],
    },
    binaryChecks: [groundingCheck, whyNowCheck],
    rubric: actionRubric,
    expectedBehavior:
      "An explicit offer to introduce is a strong, time-sensitive opening from an active connector. Expect a high priority_score, an appropriate touchpoint (follow_up or introduction), and a 'Why now:' rationale citing the offer.",
  },
  {
    label: "borderline-moderate-signal",
    promptVersion: "v1",
    input: {
      fullName: "Elena Vasquez",
      contextText:
        "Institutional funder. Early-stage relationship. One prior email exchange, no reply.",
      results: [
        {
          alert_source: "linkedin",
          title: "Posted about attending a governance conference",
          content_summary:
            "Mentioned looking forward to a panel on transparency at an unnamed conference next quarter.",
          link: "https://example.org/li/elena",
          pubDate: "2026-06-12",
        },
      ],
      touchpoints: [],
    },
    binaryChecks: [noActionInvariant, groundingCheck],
    rubric: noActionRubric,
    expectedBehavior:
      "A vague future-conference mention with no reciprocity is a monitoring signal, not an outreach trigger. Expect a conservative call (priority_score <= 7, no_action) — but a slightly higher score with a grounded rationale is tolerable.",
  },
];
