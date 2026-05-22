import { z } from "zod";

export const relationshipStageValues = [
  "no relationship",
  "early",
  "warm",
  "active",
  "stalled",
  "dormant",
] as const;

export const responsivenessValues = ["high", "moderate", "low", "none"] as const;

export const momentumValues = ["increasing", "stable", "declining"] as const;

export const touchpointTypeValues = [
  "congratulations",
  "collaboration",
  "content_sharing",
  "introduction",
  "meeting_request",
  "invitation",
  "intermediary_engagement",
  "follow_up",
  "no_action",
] as const;

export const alertSourceValues = ["linkedin", "email", "google_alert"] as const;

export const PLACEHOLDER_DRAFT = "No outreach recommended at this time.";
export const MIN_REAL_DRAFT_LEN = 40;

export const keyAlertSchema = z.object({
  alert_source: z.enum(alertSourceValues),
  headline: z.string(),
  content_summary: z.string(),
  source_link: z.string(),
});

export const agentOutputSchema = z
  .object({
    relationship_state: z.object({
      stage: z.enum(relationshipStageValues),
      responsiveness: z.enum(responsivenessValues),
      momentum: z.enum(momentumValues),
      interpretation: z.string().min(1),
    }),
    monitoring_results: z.object({
      summary: z.string(),
      key_alerts: z.array(keyAlertSchema),
    }),
    potential_touchpoint: z.object({
      touchpoint_type: z.enum(touchpointTypeValues),
      priority_score: z.number().int().min(1).max(10),
      engagement_rationale: z.string(),
      draft_content: z.string(),
    }),
  })
  .superRefine((output, ctx) => {
    const t = output.potential_touchpoint;
    if (t.priority_score <= 7 && t.touchpoint_type !== "no_action") {
      ctx.addIssue({
        code: "custom",
        path: ["potential_touchpoint", "touchpoint_type"],
        message: `priority_score ${t.priority_score} requires touchpoint_type "no_action"`,
      });
    }
    if (t.touchpoint_type === "no_action" && t.draft_content !== PLACEHOLDER_DRAFT) {
      ctx.addIssue({
        code: "custom",
        path: ["potential_touchpoint", "draft_content"],
        message: `touchpoint_type "no_action" requires draft_content = "${PLACEHOLDER_DRAFT}"`,
      });
    }
    if (
      t.touchpoint_type !== "no_action" &&
      t.priority_score >= 8 &&
      t.draft_content.trim().length < MIN_REAL_DRAFT_LEN
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["potential_touchpoint", "draft_content"],
        message: `priority_score >= 8 requires draft_content >= ${MIN_REAL_DRAFT_LEN} chars`,
      });
    }
    if (
      t.touchpoint_type !== "no_action" &&
      !/^why\s+now\s*:/i.test(t.engagement_rationale.trim())
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["potential_touchpoint", "engagement_rationale"],
        message: `engagement_rationale must begin with "Why now:" when touchpoint_type != no_action`,
      });
    }
  });

export type AgentOutput = z.infer<typeof agentOutputSchema>;

// Stage value mapping: prompt uses "no relationship" (spaced), DB enum uses "no_relationship" (underscored).
export function stageToDbEnum(stage: AgentOutput["relationship_state"]["stage"]) {
  return stage === "no relationship" ? "no_relationship" : stage;
}
