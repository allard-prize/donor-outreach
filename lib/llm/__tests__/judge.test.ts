import { describe, expect, it } from "vitest";
import {
  aggregateViolations,
  buildContext,
  extractTitleCaseBigrams,
  getPath,
  runBinaryCheck,
  runBinaryChecks,
  type BinaryCheck,
  type JudgeContext,
} from "@/lib/llm/judge";

function parsedOutput(overrides: Record<string, unknown> = {}) {
  return {
    relationship_state: {
      stage: "warm",
      responsiveness: "moderate",
      momentum: "increasing",
      interpretation: "Engaged.",
    },
    monitoring_results: { summary: "x", key_alerts: [] },
    potential_touchpoint: {
      touchpoint_type: "congratulations",
      priority_score: 9,
      engagement_rationale: "Why now: the Meridian Foundation appointment is fresh.",
      draft_content: "Congratulations on the Meridian Foundation role.",
    },
    ...overrides,
  };
}

function ctxFor(parsed: Record<string, unknown>, input: Record<string, unknown> = {}): JudgeContext {
  return buildContext(input, parsed).ctx;
}

describe("helpers", () => {
  it("getPath walks dotted paths and is null-safe", () => {
    expect(getPath({ a: { b: { c: 3 } } }, "a.b.c")).toBe(3);
    // Faithful to the harness reduce: a null mid-path short-circuits to null.
    expect(getPath({ a: null }, "a.b.c")).toBeNull();
    expect(getPath(null, "a")).toBeUndefined();
    expect(getPath({ a: { b: 1 } }, "")).toBeUndefined();
  });

  it("extractTitleCaseBigrams pulls Title Case bigrams", () => {
    expect(extractTitleCaseBigrams("the Meridian Foundation hired Jordan Avery")).toEqual([
      "Meridian Foundation",
      "Jordan Avery",
    ]);
    expect(extractTitleCaseBigrams(42)).toEqual([]);
  });
});

describe("regex check", () => {
  const check: BinaryCheck = {
    check_id: "why-now",
    kind: "regex",
    field: "parsed_output.potential_touchpoint.engagement_rationale",
    patterns: ["^\\s*why\\s+now\\s*:"],
    must_match: true,
  };

  it("passes when the required pattern matches", () => {
    const r = runBinaryCheck(check, ctxFor(parsedOutput()));
    expect(r.passed).toBe(true);
  });

  it("fails when must_match pattern is absent", () => {
    const p = parsedOutput();
    (p.potential_touchpoint as Record<string, unknown>).engagement_rationale = "No prefix here.";
    expect(runBinaryCheck(check, ctxFor(p)).passed).toBe(false);
  });

  it("must_not_match fails on a forbidden pattern", () => {
    const forbidden: BinaryCheck = {
      check_id: "no-unsubscribe",
      kind: "regex",
      field: "parsed_output.potential_touchpoint.draft_content",
      patterns: ["unsubscribe"],
      must_not_match: true,
    };
    const p = parsedOutput();
    (p.potential_touchpoint as Record<string, unknown>).draft_content = "Click here to unsubscribe.";
    expect(runBinaryCheck(forbidden, ctxFor(p)).passed).toBe(false);
  });
});

describe("schema check", () => {
  const check: BinaryCheck = { check_id: "contract", kind: "schema", validator: "validate-agent-output" };

  it("passes when the contract is valid", () => {
    expect(runBinaryCheck(check, ctxFor(parsedOutput())).passed).toBe(true);
  });

  it("fails when the contract is invalid", () => {
    const p = parsedOutput();
    (p.relationship_state as Record<string, unknown>).stage = "frosty";
    const r = runBinaryCheck(check, ctxFor(p));
    expect(r.passed).toBe(false);
    expect(r.detail).toContain("stage");
  });
});

describe("enum-membership check", () => {
  const check: BinaryCheck = {
    check_id: "type-allowed",
    kind: "enum-membership",
    path: "potential_touchpoint.touchpoint_type",
    allowed: ["congratulations", "no_action"],
  };

  it("passes when the value is in the allowed set", () => {
    expect(runBinaryCheck(check, ctxFor(parsedOutput())).passed).toBe(true);
  });

  it("fails when the value is outside the allowed set", () => {
    const p = parsedOutput();
    (p.potential_touchpoint as Record<string, unknown>).touchpoint_type = "follow_up";
    expect(runBinaryCheck(check, ctxFor(p)).passed).toBe(false);
  });
});

describe("invariant check", () => {
  const check: BinaryCheck = {
    check_id: "low-score-no-action",
    kind: "invariant",
    rule: 'potential_touchpoint.priority_score > 7 || potential_touchpoint.touchpoint_type === "no_action"',
  };

  it("passes a high-score action output", () => {
    expect(runBinaryCheck(check, ctxFor(parsedOutput())).passed).toBe(true);
  });

  it("passes a low-score no_action output", () => {
    const p = parsedOutput();
    p.potential_touchpoint = {
      touchpoint_type: "no_action",
      priority_score: 3,
      engagement_rationale: "weak",
      draft_content: "No outreach recommended at this time.",
    };
    expect(runBinaryCheck(check, ctxFor(p)).passed).toBe(true);
  });

  it("fails a low-score non-no_action output", () => {
    const p = parsedOutput();
    (p.potential_touchpoint as Record<string, unknown>).priority_score = 5;
    expect(runBinaryCheck(check, ctxFor(p)).passed).toBe(false);
  });
});

describe("conditional why-now invariant (eval-cases whyNowCheck)", () => {
  // Mirrors lib/llm/eval-cases.ts whyNowCheck — proves the path-rewrite leaves
  // `.toLowerCase().indexOf(...)` intact and the no_action branch is exempt.
  const check: BinaryCheck = {
    check_id: "why-now-prefix",
    kind: "invariant",
    rule: "potential_touchpoint.touchpoint_type === 'no_action' || potential_touchpoint.engagement_rationale.toLowerCase().indexOf('why now') === 0",
  };

  it("passes an action output that starts with 'Why now:'", () => {
    expect(runBinaryCheck(check, ctxFor(parsedOutput())).passed).toBe(true);
  });

  it("fails an action output missing the prefix", () => {
    const p = parsedOutput();
    (p.potential_touchpoint as Record<string, unknown>).engagement_rationale =
      "Scoring rationale: the appointment is fresh and mission-aligned.";
    expect(runBinaryCheck(check, ctxFor(p)).passed).toBe(false);
  });

  it("exempts a no_action output (no prefix required)", () => {
    const p = parsedOutput();
    p.potential_touchpoint = {
      touchpoint_type: "no_action",
      priority_score: 5,
      engagement_rationale: "Scoring rationale: cold relationship, no access path.",
      draft_content: "No outreach recommended at this time.",
    };
    expect(runBinaryCheck(check, ctxFor(p)).passed).toBe(true);
  });
});

describe("rule-table check", () => {
  const check: BinaryCheck = {
    check_id: "score-type-pairs",
    kind: "rule-table",
    key_paths: ["potential_touchpoint.priority_score", "potential_touchpoint.touchpoint_type"],
    allowed_pairs: [
      [9, "congratulations"],
      [8, "follow_up"],
    ],
  };

  it("passes when the tuple matches an allowed pair", () => {
    expect(runBinaryCheck(check, ctxFor(parsedOutput())).passed).toBe(true);
  });

  it("fails when the tuple is not allowed", () => {
    const p = parsedOutput();
    (p.potential_touchpoint as Record<string, unknown>).priority_score = 8;
    // 8 + congratulations is not in the table
    expect(runBinaryCheck(check, ctxFor(p)).passed).toBe(false);
  });

  it("reads input.-prefixed paths from the context", () => {
    const inputCheck: BinaryCheck = {
      check_id: "input-pair",
      kind: "rule-table",
      key_paths: ["input.region", "potential_touchpoint.touchpoint_type"],
      allowed_pairs: [["EU", "congratulations"]],
    };
    expect(runBinaryCheck(inputCheck, ctxFor(parsedOutput(), { region: "EU" })).passed).toBe(true);
  });
});

describe("cross-reference check", () => {
  const check: BinaryCheck = {
    check_id: "grounded",
    kind: "cross-reference",
    source_field: "potential_touchpoint.engagement_rationale",
    context_fields: ["input.contextText"],
    stoplist: ["Why Now"],
  };

  it("passes when proper nouns trace to the context", () => {
    const ctx = ctxFor(parsedOutput(), {
      contextText: "Works at the Meridian Foundation on rule-of-law programs.",
    });
    expect(runBinaryCheck(check, ctx).passed).toBe(true);
  });

  it("fails when the rationale invents an ungrounded proper noun", () => {
    const p = parsedOutput();
    (p.potential_touchpoint as Record<string, unknown>).engagement_rationale =
      "Why now: the Stanford Initiative announcement is timely.";
    const ctx = ctxFor(p, { contextText: "Works at the Meridian Foundation." });
    const r = runBinaryCheck(check, ctx);
    expect(r.passed).toBe(false);
    expect(r.detail).toContain("Stanford Initiative");
  });

  it("passes vacuously when there are no proper-noun bigrams", () => {
    const p = parsedOutput();
    (p.potential_touchpoint as Record<string, unknown>).engagement_rationale =
      "Why now: a timely opening worth a brief note.";
    expect(runBinaryCheck(check, ctxFor(p, { contextText: "x" })).passed).toBe(true);
  });
});

describe("aggregateViolations", () => {
  it("sums binary + contract + rubric signals", () => {
    const checks: BinaryCheck[] = [
      { check_id: "a", kind: "enum-membership", path: "potential_touchpoint.touchpoint_type", allowed: ["no_action"] },
      { check_id: "b", kind: "schema", validator: "validate-agent-output" },
    ];
    const ctx = ctxFor(parsedOutput()); // valid contract, type=congratulations
    const results = runBinaryChecks(checks, ctx);
    // enum fails (congratulations not in [no_action]); schema passes (contract valid)
    const agg = aggregateViolations({
      binaryResults: results,
      contractValid: ctx.contract_valid,
      rubricViolations: 2,
    });
    expect(agg.binary).toBe(1);
    expect(agg.contract).toBe(0);
    expect(agg.rubric).toBe(2);
    expect(agg.total).toBe(3);
  });

  it("counts an invalid contract as one violation", () => {
    const p = parsedOutput();
    (p.relationship_state as Record<string, unknown>).stage = "frosty";
    const ctx = ctxFor(p);
    const agg = aggregateViolations({ binaryResults: [], contractValid: ctx.contract_valid, rubricViolations: 0 });
    expect(agg.contract).toBe(1);
    expect(agg.total).toBe(1);
  });
});
