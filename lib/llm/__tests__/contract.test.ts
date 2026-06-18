import { describe, expect, it } from "vitest";
import { validateAgentOutput, stripFences } from "@/lib/llm/contract";

function validOutput() {
  return {
    relationship_state: {
      stage: "warm",
      responsiveness: "moderate",
      momentum: "increasing",
      interpretation: "Engaged contact with recent reciprocity.",
    },
    monitoring_results: {
      summary: "One fresh alert this week.",
      key_alerts: [
        {
          alert_source: "google_alert",
          headline: "Named to a board",
          content_summary: "Joined the board of a justice foundation.",
          source_link: "https://example.org/x",
        },
      ],
    },
    potential_touchpoint: {
      touchpoint_type: "congratulations",
      priority_score: 9,
      engagement_rationale:
        "Why now: a fresh, dated board appointment creates a timely opening.",
      draft_content:
        "Congratulations on the appointment — your focus on judicial independence aligns closely with our mission.",
    },
  };
}

describe("validateAgentOutput", () => {
  it("accepts a well-formed action output", () => {
    const r = validateAgentOutput(validOutput());
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.parsed).not.toBeNull();
  });

  it("accepts a well-formed no_action output", () => {
    const o = validOutput();
    o.potential_touchpoint = {
      touchpoint_type: "no_action",
      priority_score: 4,
      engagement_rationale: "Signal too weak to act on.",
      draft_content: "No outreach recommended at this time.",
    };
    expect(validateAgentOutput(o).valid).toBe(true);
  });

  it("rejects an invalid stage enum", () => {
    const o = validOutput();
    o.relationship_state.stage = "frosty";
    const r = validateAgentOutput(o);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("relationship_state.stage"))).toBe(true);
  });

  it("rejects an invalid alert_source enum", () => {
    const o = validOutput();
    o.monitoring_results.key_alerts[0].alert_source = "twitter";
    const r = validateAgentOutput(o);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("alert_source"))).toBe(true);
  });

  it("rejects priority_score <= 7 with a non-no_action type", () => {
    const o = validOutput();
    o.potential_touchpoint.priority_score = 6;
    // type stays "congratulations", draft is real → two invariant violations
    const r = validateAgentOutput(o);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('requires touchpoint_type="no_action"'))).toBe(true);
  });

  it("rejects priority_score >= 8 with the placeholder draft", () => {
    const o = validOutput();
    o.potential_touchpoint.draft_content = "No outreach recommended at this time.";
    const r = validateAgentOutput(o);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("requires a real draft"))).toBe(true);
  });

  it("rejects an out-of-range priority_score", () => {
    const o = validOutput();
    o.potential_touchpoint.priority_score = 11;
    const r = validateAgentOutput(o);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("out of range"))).toBe(true);
  });

  it("does NOT enforce the Why now: prefix (Phase 1 contract parity)", () => {
    const o = validOutput();
    o.potential_touchpoint.engagement_rationale =
      "A fresh, dated board appointment creates a timely opening.";
    // No "Why now:" prefix — the contract still passes; that rule is a binary check.
    expect(validateAgentOutput(o).valid).toBe(true);
  });

  it("parses a raw fenced JSON string", () => {
    const raw = "```json\n" + JSON.stringify(validOutput()) + "\n```";
    expect(validateAgentOutput(raw).valid).toBe(true);
  });

  it("reports a parse failure on non-JSON", () => {
    const r = validateAgentOutput("not json at all");
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toContain("failed to parse");
  });
});

describe("stripFences", () => {
  it("strips ```json fences", () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("leaves bare JSON untouched", () => {
    expect(stripFences('{"a":1}')).toBe('{"a":1}');
  });
});
