import { agentOutputSchema, type AgentOutput } from "@/lib/llm/schema";
import {
  loadAgentPrompts,
  renderUserPrompt,
  type AgentPromptInputs,
  type PromptVersion,
} from "@/lib/llm/prompts";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = process.env.OPENROUTER_AGENT_MODEL ?? "anthropic/claude-sonnet-4.6";
const DEFAULT_TIMEOUT_MS = 90_000;

export type AgentCallResult =
  | {
      ok: true;
      output: AgentOutput;
      rawOutput: string;
      model: string;
      promptVersion: PromptVersion;
      costUsd: number;
      promptTokens: number;
      completionTokens: number;
      latencyMs: number;
    }
  | {
      ok: false;
      stage: "openrouter_call" | "parse" | "validate";
      errorMessage: string;
      rawOutput?: string;
      model: string;
      promptVersion: PromptVersion;
      costUsd: number;
      promptTokens: number;
      completionTokens: number;
      latencyMs: number;
    };

type OpenRouterResponse = {
  id?: string;
  choices?: { message?: { content?: string } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
  };
};

export async function runAgent(
  inputs: AgentPromptInputs,
  opts: {
    model?: string;
    promptVersion?: PromptVersion;
    timeoutMs?: number;
  } = {}
): Promise<AgentCallResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const model = opts.model ?? DEFAULT_MODEL;
  const promptVersion: PromptVersion = opts.promptVersion ?? "v1";
  const { system, userTemplate } = loadAgentPrompts(promptVersion);
  const userPrompt = renderUserPrompt(userTemplate, inputs);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.OPENROUTER_REFERER ?? "https://github.com/allard-prize",
        "X-Title": "Allard Prize Donor Outreach",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        usage: { include: true },
      }),
    });
  } catch (err) {
    clearTimeout(timeout);
    return {
      ok: false,
      stage: "openrouter_call",
      errorMessage: err instanceof Error ? err.message : String(err),
      model,
      promptVersion,
      costUsd: 0,
      promptTokens: 0,
      completionTokens: 0,
      latencyMs: Date.now() - startedAt,
    };
  }
  clearTimeout(timeout);
  const latencyMs = Date.now() - startedAt;

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return {
      ok: false,
      stage: "openrouter_call",
      errorMessage: `OpenRouter ${response.status}: ${body.slice(0, 500)}`,
      model,
      promptVersion,
      costUsd: 0,
      promptTokens: 0,
      completionTokens: 0,
      latencyMs,
    };
  }

  const payload = (await response.json()) as OpenRouterResponse;
  const rawOutput = payload.choices?.[0]?.message?.content ?? "";
  const promptTokens = payload.usage?.prompt_tokens ?? 0;
  const completionTokens = payload.usage?.completion_tokens ?? 0;
  const costUsd = Number(payload.usage?.cost ?? 0);

  const cleaned = stripJsonFences(rawOutput);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    return {
      ok: false,
      stage: "parse",
      errorMessage: err instanceof Error ? err.message : String(err),
      rawOutput,
      model,
      promptVersion,
      costUsd,
      promptTokens,
      completionTokens,
      latencyMs,
    };
  }

  const result = agentOutputSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      stage: "validate",
      errorMessage: result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
      rawOutput,
      model,
      promptVersion,
      costUsd,
      promptTokens,
      completionTokens,
      latencyMs,
    };
  }

  return {
    ok: true,
    output: result.data,
    rawOutput,
    model,
    promptVersion,
    costUsd,
    promptTokens,
    completionTokens,
    latencyMs,
  };
}

function stripJsonFences(s: string): string {
  return s
    .trim()
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
}
