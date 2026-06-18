/**
 * Phase 2E — contract validator.
 *
 * Faithful TypeScript port of the Phase 1 n8n harness contract check
 * (`ap-donor-outreach/__tests__/validate-agent-output.js`). Same enums, same
 * structural checks, same priority/draft invariants — so the eval harness
 * reproduces Phase 1 `contract_valid` / `contract_errors` exactly.
 *
 * Intentional parity note: the Phase 1 *contract* does NOT enforce the
 * "Why now:" rationale prefix — that rule is a separate binary regex check in
 * the harness (see lib/llm/eval-cases.ts). The production Zod schema
 * (lib/llm/schema.ts) folds "Why now:" into validation because production
 * should reject it at runtime; the contract validator here deliberately omits
 * it to keep eval violation counts aligned with Phase 1.
 *
 * Enum vocab is imported from schema.ts so there is a single source of truth.
 */
import {
  alertSourceValues,
  momentumValues,
  relationshipStageValues,
  responsivenessValues,
  touchpointTypeValues,
  PLACEHOLDER_DRAFT,
  MIN_REAL_DRAFT_LEN,
} from "@/lib/llm/schema";

const STAGE = new Set<string>(relationshipStageValues);
const RESPONSIVENESS = new Set<string>(responsivenessValues);
const MOMENTUM = new Set<string>(momentumValues);
const TOUCHPOINT_TYPE = new Set<string>(touchpointTypeValues);
const ALERT_SOURCE = new Set<string>(alertSourceValues);

export type ContractResult = {
  valid: boolean;
  parsed: Record<string, unknown> | null;
  errors: string[];
};

export function stripFences(s: string): string {
  let out = s.trim();
  out = out.replace(/^```(?:json)?\s*\n?/i, "");
  out = out.replace(/\n?```\s*$/i, "");
  return out.trim();
}

/**
 * Lenient parse: strip fences and JSON.parse, returning the object (or null on
 * failure) WITHOUT validating. The eval harness needs the parsed object to run
 * binary checks even when the output fails the contract.
 */
export function parseAgentOutput(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(stripFences(raw));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Validate an agent output against the Phase 1 contract.
 * Accepts either the raw string (parses + strips fences) or an
 * already-parsed object (the production path, where runAgent parsed it).
 */
export function validateAgentOutput(raw: unknown): ContractResult {
  const errors: string[] = [];

  let parsed: unknown;
  if (typeof raw === "string") {
    if (raw.trim() === "") {
      return { valid: false, parsed: null, errors: ["failed to parse: empty input"] };
    }
    try {
      parsed = JSON.parse(stripFences(raw));
    } catch (e) {
      return {
        valid: false,
        parsed: null,
        errors: [`failed to parse JSON: ${e instanceof Error ? e.message : String(e)}`],
      };
    }
  } else {
    parsed = raw;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { valid: false, parsed: null, errors: ["failed to parse: root must be an object"] };
  }

  const obj = parsed as Record<string, unknown>;

  // --- relationship_state ---
  const rs = obj.relationship_state as Record<string, unknown> | undefined;
  if (!rs || typeof rs !== "object") {
    errors.push("missing or invalid relationship_state");
  } else {
    if (!STAGE.has(rs.stage as string)) {
      errors.push(`invalid relationship_state.stage: ${JSON.stringify(rs.stage)}`);
    }
    if (!RESPONSIVENESS.has(rs.responsiveness as string)) {
      errors.push(
        `invalid relationship_state.responsiveness: ${JSON.stringify(rs.responsiveness)}`
      );
    }
    if (!MOMENTUM.has(rs.momentum as string)) {
      errors.push(`invalid relationship_state.momentum: ${JSON.stringify(rs.momentum)}`);
    }
    if (typeof rs.interpretation !== "string" || rs.interpretation.length === 0) {
      errors.push("missing relationship_state.interpretation");
    }
  }

  // --- monitoring_results ---
  const mr = obj.monitoring_results as Record<string, unknown> | undefined;
  if (!mr || typeof mr !== "object") {
    errors.push("missing or invalid monitoring_results");
  } else {
    if (typeof mr.summary !== "string") errors.push("missing monitoring_results.summary");
    if (!Array.isArray(mr.key_alerts)) {
      errors.push("monitoring_results.key_alerts must be an array");
    } else {
      mr.key_alerts.forEach((a: unknown, i: number) => {
        if (!a || typeof a !== "object") {
          errors.push(`key_alerts[${i}] is not an object`);
          return;
        }
        const alert = a as Record<string, unknown>;
        if (!ALERT_SOURCE.has(alert.alert_source as string)) {
          errors.push(`key_alerts[${i}].alert_source invalid: ${JSON.stringify(alert.alert_source)}`);
        }
        if (typeof alert.headline !== "string") errors.push(`key_alerts[${i}].headline missing`);
        if (typeof alert.content_summary !== "string") {
          errors.push(`key_alerts[${i}].content_summary missing`);
        }
        if (typeof alert.source_link !== "string") errors.push(`key_alerts[${i}].source_link missing`);
      });
    }
  }

  // --- potential_touchpoint ---
  const pt = obj.potential_touchpoint as Record<string, unknown> | undefined;
  if (!pt || typeof pt !== "object") {
    errors.push("missing or invalid potential_touchpoint");
  } else {
    if (!TOUCHPOINT_TYPE.has(pt.touchpoint_type as string)) {
      errors.push(`invalid potential_touchpoint.touchpoint_type: ${JSON.stringify(pt.touchpoint_type)}`);
    }

    const scoreOk =
      typeof pt.priority_score === "number" && Number.isInteger(pt.priority_score);
    if (!scoreOk) {
      errors.push(
        `potential_touchpoint.priority_score must be an integer, got ${JSON.stringify(pt.priority_score)}`
      );
    } else if ((pt.priority_score as number) < 1 || (pt.priority_score as number) > 10) {
      errors.push(`potential_touchpoint.priority_score out of range [1,10]: ${pt.priority_score}`);
    }

    if (typeof pt.engagement_rationale !== "string" || pt.engagement_rationale.length === 0) {
      errors.push("missing potential_touchpoint.engagement_rationale");
    }
    if (typeof pt.draft_content !== "string") {
      errors.push("missing potential_touchpoint.draft_content");
    }

    // Invariants — only enforce when the individual fields are shaped correctly,
    // otherwise we'd report duplicate / confusing errors.
    const typeOk = TOUCHPOINT_TYPE.has(pt.touchpoint_type as string);
    const draftOk = typeof pt.draft_content === "string";
    const rangeOk =
      scoreOk && (pt.priority_score as number) >= 1 && (pt.priority_score as number) <= 10;

    if (typeOk && draftOk && rangeOk) {
      const score = pt.priority_score as number;
      const draft = (pt.draft_content as string).trim();
      const isPlaceholder = draft === PLACEHOLDER_DRAFT;

      if (score <= 7) {
        if (pt.touchpoint_type !== "no_action") {
          errors.push(
            `invariant violated: priority_score=${score} (<=7) requires touchpoint_type="no_action", got "${pt.touchpoint_type}"`
          );
        }
        if (!isPlaceholder) {
          errors.push(
            `invariant violated: priority_score=${score} (<=7) requires placeholder draft ("${PLACEHOLDER_DRAFT}")`
          );
        }
      } else {
        if (isPlaceholder) {
          errors.push(
            `invariant violated: priority_score=${score} (>=8) requires a real draft, got placeholder`
          );
        }
        if (draft.length < MIN_REAL_DRAFT_LEN) {
          errors.push(
            `invariant violated: priority_score=${score} (>=8) requires a real draft of at least ${MIN_REAL_DRAFT_LEN} chars, got ${draft.length}`
          );
        }
      }
    }
  }

  const valid = errors.length === 0;
  return { valid, parsed: valid ? obj : null, errors };
}
