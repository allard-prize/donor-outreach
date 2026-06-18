/**
 * Phase 2E — deterministic judge.
 *
 * Faithful TypeScript port of the Phase 1 n8n harness "Binary Check Output"
 * and "Aggregate Violations" nodes. Pure functions, no I/O, no LLM — this is
 * the layer the Vitest suite exercises and CI runs on every PR.
 *
 * A case's total violation count is the sum of three signals (matching the
 * Phase 1 "Aggregate Violations" node):
 *   total = binaryFailures + contractViolation(0|1) + rubricViolations
 * The rubric signal comes from the LLM judge (lib/llm/rubric-judge.ts) and is
 * passed in here as a count — it is not computed in this deterministic layer.
 */
import { parseAgentOutput, validateAgentOutput, type ContractResult } from "@/lib/llm/contract";

// ---------- check specs ----------

export type RegexCheck = {
  check_id: string;
  kind: "regex";
  field: string;
  patterns: string[];
  must_match?: boolean;
  must_not_match?: boolean;
};

export type SchemaCheck = {
  check_id: string;
  kind: "schema";
  validator: "validate-agent-output";
};

export type EnumMembershipCheck = {
  check_id: string;
  kind: "enum-membership";
  path: string;
  allowed: unknown[];
};

export type InvariantCheck = {
  check_id: string;
  kind: "invariant";
  rule: string;
};

export type RuleTableCheck = {
  check_id: string;
  kind: "rule-table";
  key_paths: string[];
  allowed_pairs: unknown[][];
};

export type CrossReferenceCheck = {
  check_id: string;
  kind: "cross-reference";
  source_field: string;
  context_fields: string[];
  stoplist?: string[];
};

export type BinaryCheck =
  | RegexCheck
  | SchemaCheck
  | EnumMembershipCheck
  | InvariantCheck
  | RuleTableCheck
  | CrossReferenceCheck;

export type CheckResult = {
  check_id: string;
  kind: BinaryCheck["kind"];
  passed: boolean;
  detail: string;
};

/**
 * Evaluation context. The agent-input fields (fullName, results, touchpoints,
 * content, …) are spread at the top level — `regex`/`cross-reference`/
 * `rule-table` read them either directly (`ctx[field]`) or via the `input.`
 * prefix. `parsed_output` holds the agent's parsed decision JSON.
 */
export type JudgeContext = Record<string, unknown> & {
  parsed_output: Record<string, unknown> | null;
  contract_valid: boolean;
  contract_errors: string;
};

// ---------- helpers (verbatim from harness) ----------

export function getPath(obj: unknown, path: string): unknown {
  if (!obj || !path) return undefined;
  return path
    .split(".")
    .reduce<unknown>(
      (acc, key) =>
        acc == null ? acc : (acc as Record<string, unknown>)[key],
      obj
    );
}

export function extractTitleCaseBigrams(text: unknown): string[] {
  if (typeof text !== "string") return [];
  const matches = text.match(/[A-Z][a-z]+\s+[A-Z][a-z]+/g) || [];
  return matches.map((s) => s.trim());
}

const STOP_STARTERS = new Set([
  "While", "The", "Her", "His", "When", "If", "Given", "However", "Although",
  "Their", "These", "That", "This", "As", "For", "But", "And", "Or", "Now",
  "Here", "There",
]);

// ---------- the 6 check runners ----------

function runRegex(check: RegexCheck, ctx: JudgeContext): Omit<CheckResult, "check_id" | "kind"> {
  const field = check.field;
  const target = ctx[field] != null ? ctx[field] : getPath(ctx, field);
  const targetStr = typeof target === "string" ? target : JSON.stringify(target ?? "");
  const patterns = (check.patterns || []).map((p) => new RegExp(p, "i"));

  if (check.must_not_match) {
    const matched = patterns.find((re) => re.test(targetStr));
    return { passed: !matched, detail: matched ? "matched forbidden pattern" : "" };
  }
  if (check.must_match) {
    const allMatch = patterns.every((re) => re.test(targetStr));
    return { passed: allMatch, detail: allMatch ? "" : "required patterns missing" };
  }
  return { passed: false, detail: "missing must_match/must_not_match flag" };
}

function runSchema(check: SchemaCheck, ctx: JudgeContext): Omit<CheckResult, "check_id" | "kind"> {
  if (check.validator === "validate-agent-output") {
    const valid = ctx.contract_valid === true;
    return { passed: valid, detail: valid ? "" : ctx.contract_errors || "contract invalid" };
  }
  return { passed: false, detail: "unknown schema validator" };
}

function runEnumMembership(
  check: EnumMembershipCheck,
  ctx: JudgeContext
): Omit<CheckResult, "check_id" | "kind"> {
  const value = getPath(ctx.parsed_output || {}, check.path);
  const passed = (check.allowed || []).includes(value);
  return { passed, detail: passed ? "" : "value not in allowed list" };
}

function runInvariant(
  check: InvariantCheck,
  ctx: JudgeContext
): Omit<CheckResult, "check_id" | "kind"> {
  const parsed = ctx.parsed_output;
  if (!parsed) return { passed: false, detail: "no parsed_output to evaluate invariant" };
  try {
    // Faithful port of the n8n harness: dotted paths in the rule are rewritten
    // to `o.<path>` and evaluated against the parsed output. The rule strings
    // are author-controlled (seeded with each eval case), never agent output.
    const fn = new Function(
      "o",
      "return " + check.rule.replace(/([a-z_]+(?:\.[a-z_]+)+)/gi, (m) => "o." + m)
    );
    const result = fn(parsed);
    return { passed: result === true, detail: result === true ? "" : "rule evaluated false" };
  } catch (e) {
    return { passed: false, detail: "evaluation error: " + (e instanceof Error ? e.message : String(e)) };
  }
}

function runRuleTable(
  check: RuleTableCheck,
  ctx: JudgeContext
): Omit<CheckResult, "check_id" | "kind"> {
  const sources = check.key_paths.map((p) => {
    if (p.startsWith("input.")) return getPath(ctx, p.replace(/^input\./, ""));
    return getPath(ctx.parsed_output || {}, p);
  });
  const allowed = (check.allowed_pairs || []).some((pair) =>
    pair.every((v, i) => v === sources[i])
  );
  return { passed: allowed, detail: allowed ? "" : "pair not in allowed_pairs" };
}

function runCrossReference(
  check: CrossReferenceCheck,
  ctx: JudgeContext
): Omit<CheckResult, "check_id" | "kind"> {
  const sourceVal = getPath(ctx.parsed_output || {}, check.source_field) || "";
  const stoplist = new Set(check.stoplist || []);

  let sourceTokens = extractTitleCaseBigrams(
    typeof sourceVal === "string" ? sourceVal : JSON.stringify(sourceVal)
  );
  sourceTokens = sourceTokens.filter(
    (t) => !stoplist.has(t) && !STOP_STARTERS.has(t.split(/\s+/)[0])
  );

  if (sourceTokens.length === 0) {
    return { passed: true, detail: "no proper-noun bigrams in source" };
  }

  const contextStr = (check.context_fields || [])
    .map((p) => {
      const v = p.startsWith("input.") ? ctx[p.replace(/^input\./, "")] : getPath(ctx, p);
      return typeof v === "string" ? v : JSON.stringify(v || "");
    })
    .join(" ")
    .toLowerCase();

  const missing = sourceTokens.filter((t) => !contextStr.includes(t.toLowerCase()));
  return {
    passed: missing.length === 0,
    detail: missing.length === 0 ? "" : "ungrounded tokens: " + missing.join(", "),
  };
}

// ---------- dispatch + aggregation ----------

export function runBinaryCheck(check: BinaryCheck, ctx: JudgeContext): CheckResult {
  let r: Omit<CheckResult, "check_id" | "kind">;
  switch (check.kind) {
    case "regex":
      r = runRegex(check, ctx);
      break;
    case "schema":
      r = runSchema(check, ctx);
      break;
    case "enum-membership":
      r = runEnumMembership(check, ctx);
      break;
    case "invariant":
      r = runInvariant(check, ctx);
      break;
    case "rule-table":
      r = runRuleTable(check, ctx);
      break;
    case "cross-reference":
      r = runCrossReference(check, ctx);
      break;
    default: {
      const _exhaustive: never = check;
      void _exhaustive;
      r = { passed: false, detail: "unknown check kind" };
    }
  }
  return { check_id: (check as BinaryCheck).check_id, kind: (check as BinaryCheck).kind, ...r };
}

export function runBinaryChecks(checks: BinaryCheck[], ctx: JudgeContext): CheckResult[] {
  return checks.map((c) => runBinaryCheck(c, ctx));
}

/**
 * Build the judge context from an eval-case input + the agent's parsed output.
 * Runs the contract validator and folds its result into the context so the
 * `schema` check can read `contract_valid` / `contract_errors`.
 */
export function buildContext(
  input: Record<string, unknown>,
  output: Record<string, unknown> | string | null
): { ctx: JudgeContext; contract: ContractResult } {
  // Accept a raw model string (lenient-parsed so binary checks can still run on
  // a parseable-but-invalid output) or an already-parsed object.
  const parsedOutput: Record<string, unknown> | null =
    typeof output === "string" ? parseAgentOutput(output) : output;
  const contract = validateAgentOutput(parsedOutput);
  const ctx: JudgeContext = {
    ...input,
    parsed_output: parsedOutput,
    contract_valid: contract.valid,
    contract_errors: contract.errors.join("; "),
  };
  return { ctx, contract };
}

export type ViolationBreakdown = {
  binary: number;
  contract: number;
  rubric: number;
  total: number;
};

/**
 * Aggregate violations across the three signals — matches the Phase 1
 * "Aggregate Violations" node:
 *   total = failed binary checks + (contract invalid ? 1 : 0) + rubric violations
 */
export function aggregateViolations(args: {
  binaryResults: CheckResult[];
  contractValid: boolean;
  rubricViolations: number;
}): ViolationBreakdown {
  const binary = args.binaryResults.filter((r) => !r.passed).length;
  const contract = args.contractValid ? 0 : 1;
  const rubric = Math.max(0, args.rubricViolations);
  return { binary, contract, rubric, total: binary + contract + rubric };
}
