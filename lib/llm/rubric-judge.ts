/**
 * Phase 2E — LLM rubric judge.
 *
 * Port of the Phase 1 harness "Judge Output Chain" node. Calls a small, cheap
 * model (Haiku 4.5 via OpenRouter, temp 0.1) to answer the per-case rubric:
 * each rubric entry is a binary "did this violate?" question. Only violations
 * marked `true` count. This is the only non-deterministic eval signal and is
 * never invoked from the Vitest unit suite — only from `scripts/run-eval.ts`.
 */
import type { RubricQuestion } from "@/lib/llm/eval-cases";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_JUDGE_MODEL =
  process.env.OPENROUTER_JUDGE_MODEL ?? "anthropic/claude-haiku-4.5";
const DEFAULT_TIMEOUT_MS = 60_000;

export type RubricViolation = {
  question_id: string;
  violated: boolean;
  evidence_quote: string;
};

export type RubricJudgeResult =
  | { ok: true; violations: RubricViolation[]; costUsd: number; model: string; rawOutput: string }
  | { ok: false; errorMessage: string; costUsd: number; model: string; rawOutput?: string };

// The double-quote rule mirrors Phase 1 and klaus feedback_llm_judge_no_double_quotes:
// embedded `"` in evidence_quote values breaks JSON.parse downstream.
const JUDGE_SYSTEM = `You are a strict, conservative evaluator of an AI agent's JSON output for a donor-outreach system.
You answer a set of binary rubric questions: for each, decide whether the output VIOLATED the expectation.
Be conservative — only mark violated:true when there is clear evidence in the output.

CRITICAL JSON RULE: inside evidence_quote values, NEVER use double-quote characters. If you need to reproduce
quoted phrasing from the output, wrap that phrasing in single quotes (e.g. 'defensive posture'). The whole value
must be a single valid JSON string with no embedded double quotes.

Return ONLY a JSON object of this exact shape (no prose, no code fences):
{ "violations": [ { "question_id": "<from rubric>", "violated": true|false, "evidence_quote": "<short quote or empty>" } ] }
Every rubric question must appear exactly once.`;

function buildUserPrompt(args: {
  expectedBehavior: string;
  rubric: RubricQuestion[];
  input: unknown;
  output: unknown;
}): string {
  return [
    "Expected behavior:",
    args.expectedBehavior || "(none specified)",
    "",
    "Rubric questions (each is a binary 'did this violate?' question):",
    JSON.stringify(args.rubric),
    "",
    "Agent input (case payload):",
    JSON.stringify(args.input),
    "",
    "Agent output (the JSON to evaluate):",
    JSON.stringify(args.output),
  ].join("\n");
}

function stripJsonFences(s: string): string {
  return s
    .trim()
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
}

export async function judgeRubric(args: {
  expectedBehavior: string;
  rubric: RubricQuestion[];
  input: unknown;
  output: unknown;
  model?: string;
  timeoutMs?: number;
}): Promise<RubricJudgeResult> {
  const model = args.model ?? DEFAULT_JUDGE_MODEL;

  // No rubric → nothing to judge; zero violations, zero cost.
  if (!args.rubric || args.rubric.length === 0) {
    return { ok: true, violations: [], costUsd: 0, model, rawOutput: "" };
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return { ok: false, errorMessage: "OPENROUTER_API_KEY is not set", costUsd: 0, model };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.OPENROUTER_REFERER ?? "https://github.com/allard-prize",
        // HTTP header values must be Latin1 — keep ASCII only (no em-dash).
        "X-Title": "Allard Prize Donor Outreach Eval Judge",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: JUDGE_SYSTEM },
          { role: "user", content: buildUserPrompt(args) },
        ],
        temperature: 0.1,
        usage: { include: true },
      }),
    });
  } catch (err) {
    clearTimeout(timeout);
    return {
      ok: false,
      errorMessage: err instanceof Error ? err.message : String(err),
      costUsd: 0,
      model,
    };
  }
  clearTimeout(timeout);

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return {
      ok: false,
      errorMessage: `OpenRouter ${response.status}: ${body.slice(0, 300)}`,
      costUsd: 0,
      model,
    };
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { cost?: number };
  };
  const rawOutput = payload.choices?.[0]?.message?.content ?? "";
  const costUsd = Number(payload.usage?.cost ?? 0);

  let parsed: { violations?: RubricViolation[] };
  try {
    parsed = JSON.parse(stripJsonFences(rawOutput));
  } catch (err) {
    return {
      ok: false,
      errorMessage: `judge output parse failed: ${err instanceof Error ? err.message : String(err)}`,
      rawOutput,
      costUsd,
      model,
    };
  }

  const violations = Array.isArray(parsed.violations)
    ? parsed.violations.map((v) => ({
        question_id: String(v.question_id ?? ""),
        violated: v.violated === true,
        evidence_quote: String(v.evidence_quote ?? ""),
      }))
    : [];

  return { ok: true, violations, costUsd, model, rawOutput };
}

/** Count of rubric questions the judge marked violated. */
export function countRubricViolations(violations: RubricViolation[]): number {
  return violations.filter((v) => v.violated).length;
}
