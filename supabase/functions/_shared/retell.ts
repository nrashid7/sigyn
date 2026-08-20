import { AppError } from "./errors.ts";
import type { RetellCustomTool } from "./retell-tools.ts";
export { buildCustomToolsConfig } from "./retell-tools.ts";
export {
  addRetellKnowledgeSources,
  createRetellKnowledgeBase,
  deleteRetellKnowledgeSource,
  getRetellKnowledgeBase,
} from "./retell-knowledge-client.ts";

const RETELL_API_BASE = "https://api.retellai.com";

function getRetellApiKey(): string {
  const key = Deno.env.get("RETELL_API_KEY");
  if (!key) {
    throw new AppError("Missing RETELL_API_KEY", 500, "CONFIG_ERROR");
  }
  return key;
}

async function retellFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${RETELL_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${getRetellApiKey()}`,
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new AppError(`Retell API error: ${text}`, response.status, "RETELL_ERROR");
  }

  return await response.json() as T;
}

export interface RetellLlmConfig {
  model?: string;
  model_temperature?: number;
  general_prompt?: string;
  begin_message?: string;
  general_tools?: RetellCustomTool[];
  tool_call_strict_mode?: boolean;
  knowledge_base_ids?: string[];
  kb_config?: { top_k?: number; filter_score?: number };
}

export interface RetellAgentConfig {
  agent_name: string;
  voice_id: string;
  response_engine: {
    type: "retell-llm";
    llm_id: string;
  };
  language?: string;
  webhook_url?: string;
  enable_backchannel?: boolean;
  ambient_sound?: string;
}

export async function createRetellLlm(config: RetellLlmConfig): Promise<{ llm_id: string }> {
  return await retellFetch("/create-retell-llm", {
    method: "POST",
    body: JSON.stringify(config),
  });
}

export async function updateRetellLlm(
  llmId: string,
  config: Partial<RetellLlmConfig>,
): Promise<{ llm_id: string }> {
  return await retellFetch(`/update-retell-llm/${llmId}`, {
    method: "PATCH",
    body: JSON.stringify(config),
  });
}

export async function createRetellAgent(
  config: RetellAgentConfig,
): Promise<{ agent_id: string }> {
  return await retellFetch("/create-agent", {
    method: "POST",
    body: JSON.stringify(config),
  });
}

export async function updateRetellAgent(
  agentId: string,
  config: Partial<RetellAgentConfig>,
): Promise<{ agent_id: string }> {
  return await retellFetch(`/update-agent/${agentId}`, {
    method: "PATCH",
    body: JSON.stringify(config),
  });
}

export async function createRetellPhoneNumber(
  agentId: string,
  areaCode?: number,
): Promise<{ phone_number: string; phone_number_pretty?: string }> {
  return await retellFetch("/create-phone-number", {
    method: "POST",
    body: JSON.stringify({
      inbound_agents: [{ agent_id: agentId, weight: 1 }],
      outbound_agents: [{ agent_id: agentId, weight: 1 }],
      ...(areaCode ? { area_code: areaCode } : {}),
    }),
  });
}
