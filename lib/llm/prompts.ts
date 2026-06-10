import { readFileSync } from "node:fs";
import path from "node:path";

export type PromptVersion = "v1";

export type AgentPromptInputs = {
  fullName: string;
  contextText: string;
  results: unknown;
  touchpoints: unknown;
};

const PROMPTS_DIR = path.join(process.cwd(), "prompts");

function loadPromptFile(filename: string): string {
  return readFileSync(path.join(PROMPTS_DIR, filename), "utf8");
}

export function loadAgentPrompts(version: PromptVersion = "v1") {
  return {
    system: loadPromptFile(`agent-system-${version}.md`),
    userTemplate: loadPromptFile(`agent-user-${version}.md`),
    version,
  };
}

export function renderUserPrompt(template: string, inputs: AgentPromptInputs): string {
  return template
    .replaceAll("{{RESULTS_JSON}}", JSON.stringify(inputs.results ?? []))
    .replaceAll("{{CONTEXT}}", inputs.contextText ?? "")
    .replaceAll("{{TOUCHPOINTS_JSON}}", JSON.stringify(inputs.touchpoints ?? []))
    .replaceAll("{{FULL_NAME}}", inputs.fullName);
}
