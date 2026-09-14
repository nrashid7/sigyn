import { assertEquals, assertStringIncludes, assertThrows } from "jsr:@std/assert@1";
import { AppError } from "../_shared/errors.ts";
import type { BusinessPromptData } from "../_shared/prompts.ts";
import {
  type BuildAgentConfigInput,
  buildAgentConfig,
  DEFAULT_DATA_COLLECTION,
  type ElAgentConfig,
  normalizePhone,
  type TemplateConfig,
} from "../_shared/elevenlabs.ts";

const template: TemplateConfig = {
  system_prompt: "You are Dexter for {{business_name}}.",
  first_message: "Hi from {{business_name}}.",
  qualification_questions: ["What service do you need?"],
  booking_rules: ["Always confirm the callback number."],
  escalation_rules: [
    { condition: "the caller is angry", action: "offer a transfer" },
  ],
  faq_rules: ["Quote price ranges only."],
  objection_handlers: [
    { trigger: "too expensive", response: "{{business_name}} offers financing." },
  ],
  elevenlabs: {
    llm: "gpt-4o-mini",
    temperature: 0.7,
    data_collection: { company: { type: "string", description: "x" } },
  },
};

const business: BusinessPromptData = {
  name: "Acme Plumbing",
  timezone: "America/Chicago",
  hours: {
    monday: { open: "9:00 AM", close: "5:00 PM" },
    sunday: { open: "", close: "", closed: true },
  },
};

const toolIds = {
  check_availability: "t1",
  book_appointment: "t2",
  qualify_lead: "t3",
};

function input(overrides: Partial<BuildAgentConfigInput> = {}): BuildAgentConfigInput {
  return {
    agentRowId: "agent-row-1",
    agentName: "Front Desk",
    template: structuredClone(template),
    business,
    callPrefs: null,
    voiceId: "voice_abc",
    kbDocs: [],
    toolIds,
    includeCalendar: true,
    ...overrides,
  };
}

interface BuiltInTool {
  name: string;
  description: string;
  params: Record<string, unknown>;
}

interface TransferTool extends BuiltInTool {
  params: {
    system_tool_type: string;
    transfers: Array<{
      transfer_destination: { type: string; phone_number: string };
      condition: string;
      transfer_type: string;
    }>;
  };
}

interface AgentSection {
  first_message: string;
  language: string;
  prompt: {
    prompt: string;
    llm: string;
    temperature: number;
    tool_ids: string[];
    built_in_tools: {
      end_call: BuiltInTool | null;
      transfer_to_number: TransferTool | null;
      voicemail_detection: BuiltInTool | null;
    };
    knowledge_base: Array<Record<string, unknown>>;
    rag: { enabled: boolean };
  };
}

function agentOf(config: ElAgentConfig): AgentSection {
  return (config.conversation_config as { agent: AgentSection }).agent;
}

// --- name and top-level shape ---

Deno.test("buildAgentConfig: names the agent after the business, agent and row id", () => {
  const config = buildAgentConfig(input());
  assertEquals(config.name, "Acme Plumbing · Front Desk · agent-row-1");
  assertStringIncludes(config.name, "Acme Plumbing");
  assertStringIncludes(config.name, "Front Desk");
  assertStringIncludes(config.name, "agent-row-1");
});

Deno.test("buildAgentConfig: sets the voice, language and call ceiling", () => {
  const config = buildAgentConfig(input());
  assertEquals(config.conversation_config.tts, { voice_id: "voice_abc" });
  assertEquals(config.conversation_config.conversation, {
    max_duration_seconds: 900,
  });
  assertEquals(agentOf(config).language, "en");
  assertEquals(agentOf(config).prompt.rag, { enabled: false });
});

// --- prompt rendering ---

Deno.test("buildAgentConfig: renders the system prompt and first message", () => {
  const config = buildAgentConfig(input());
  const agent = agentOf(config);

  assertEquals(agent.first_message, "Hi from Acme Plumbing.");
  assertStringIncludes(agent.prompt.prompt, "You are Dexter for Acme Plumbing.");
  assertStringIncludes(agent.prompt.prompt, "Acme Plumbing offers financing.");
  assertEquals(agent.prompt.prompt.includes("{{"), false);
});

Deno.test("buildAgentConfig: adds a Tools section that never mentions business_id", () => {
  const config = buildAgentConfig(input());
  const prompt = agentOf(config).prompt.prompt;

  assertStringIncludes(prompt, "\n\n## Tools\n");
  assertStringIncludes(
    prompt,
    "Use qualify_lead once the caller shows buying interest or asks for a quote.",
  );
  assertStringIncludes(prompt, "Use check_availability before offering any appointment time.");
  assertStringIncludes(
    prompt,
    "Use book_appointment only after the caller has confirmed their name, callback number and the exact time.",
  );
  assertEquals(prompt.includes("business_id"), false);
});

Deno.test("buildAgentConfig: omits the calendar tool guidance when calendar is off", () => {
  const prompt = agentOf(buildAgentConfig(input({ includeCalendar: false }))).prompt.prompt;

  assertStringIncludes(prompt, "## Tools");
  assertEquals(prompt.includes("check_availability"), false);
  assertEquals(prompt.includes("book_appointment"), false);
});

Deno.test("buildAgentConfig: adds a Transfers section only when a number exists", () => {
  const without = agentOf(buildAgentConfig(input())).prompt.prompt;
  assertEquals(without.includes("## Transfers"), false);

  const withNumber = agentOf(
    buildAgentConfig(input({ callPrefs: { transfer_number: "+1 (555) 000-0000" } })),
  ).prompt.prompt;
  assertStringIncludes(withNumber, "\n\n## Transfers\n");
  assertStringIncludes(
    withNumber,
    "Transfer to a human with transfer_to_number when the caller asks for a person, is upset after two attempts to help, or reports an emergency.",
  );
});

Deno.test("buildAgentConfig: adds an After hours section with the message verbatim", () => {
  const config = buildAgentConfig(
    input({ callPrefs: { after_hours_message: "We are closed until 8am." } }),
  );
  assertStringIncludes(
    agentOf(config).prompt.prompt,
    "\n\n## After hours\nWe are closed until 8am.",
  );
});

Deno.test("buildAgentConfig: renders template variables inside the After hours message", () => {
  const config = buildAgentConfig(
    input({
      callPrefs: {
        after_hours_message: "We're closed — {{business_name}} reopens at 9am.",
      },
    }),
  );
  const prompt = agentOf(config).prompt.prompt;

  assertStringIncludes(prompt, "Acme Plumbing reopens");
  assertEquals(prompt.includes("{{"), false);
});

Deno.test("buildAgentConfig: omits the After hours section when the message is empty", () => {
  const config = buildAgentConfig(input({ callPrefs: { after_hours_message: "" } }));
  assertEquals(agentOf(config).prompt.prompt.includes("## After hours"), false);
});

// --- template variable guard ---

Deno.test("buildAgentConfig: throws TEMPLATE_ERROR on an unrendered prompt variable", () => {
  const broken = structuredClone(template);
  broken.system_prompt = "You are Dexter for {{unknown_var}}.";

  const err = assertThrows(
    () => buildAgentConfig(input({ template: broken })),
    AppError,
  );
  assertEquals(err.code, "TEMPLATE_ERROR");
  assertEquals(err.statusCode, 500);
});

Deno.test("buildAgentConfig: throws TEMPLATE_ERROR on an unrendered first_message variable", () => {
  const broken = structuredClone(template);
  broken.first_message = "Hi from {{unknown_var}}.";

  const err = assertThrows(
    () => buildAgentConfig(input({ template: broken })),
    AppError,
  );
  assertEquals(err.code, "TEMPLATE_ERROR");
});

Deno.test("buildAgentConfig: allows ElevenLabs system__ variables through the guard", () => {
  const withSystemVar = structuredClone(template);
  withSystemVar.first_message = "Hi, this is Acme, calling {{system__caller_id}}.";

  const config = buildAgentConfig(input({ template: withSystemVar }));
  assertEquals(
    agentOf(config).first_message,
    "Hi, this is Acme, calling {{system__caller_id}}.",
  );
});

Deno.test("buildAgentConfig: falls back to a default first message", () => {
  const noFirstMessage = structuredClone(template);
  delete noFirstMessage.first_message;

  const config = buildAgentConfig(input({ template: noFirstMessage }));
  assertEquals(
    agentOf(config).first_message,
    "Hi, thanks for calling Acme Plumbing. How can I help you today?",
  );
});

// --- llm settings ---

Deno.test("buildAgentConfig: uses the template llm and temperature", () => {
  const agent = agentOf(buildAgentConfig(input()));
  assertEquals(agent.prompt.llm, "gpt-4o-mini");
  assertEquals(agent.prompt.temperature, 0.7);
});

Deno.test("buildAgentConfig: defaults the llm and temperature", () => {
  const bare = structuredClone(template);
  delete bare.elevenlabs;

  const agent = agentOf(buildAgentConfig(input({ template: bare })));
  assertEquals(agent.prompt.llm, "gpt-4o-mini");
  assertEquals(agent.prompt.temperature, 0.5);
});

// --- tool ids ---

Deno.test("buildAgentConfig: orders tool_ids qualify, availability, booking", () => {
  assertEquals(agentOf(buildAgentConfig(input())).prompt.tool_ids, ["t3", "t1", "t2"]);
});

Deno.test("buildAgentConfig: only wires qualify_lead when calendar is off", () => {
  assertEquals(
    agentOf(buildAgentConfig(input({ includeCalendar: false }))).prompt.tool_ids,
    ["t3"],
  );
});

// --- built-in tools ---

Deno.test("buildAgentConfig: always wires end_call", () => {
  assertEquals(agentOf(buildAgentConfig(input())).prompt.built_in_tools.end_call, {
    name: "end_call",
    description: "End the call when the caller says goodbye or the request is fully handled.",
    params: { system_tool_type: "end_call" },
  });
});

Deno.test("buildAgentConfig: transfer_to_number is null without a usable number", () => {
  assertEquals(
    agentOf(buildAgentConfig(input())).prompt.built_in_tools.transfer_to_number,
    null,
  );
  assertEquals(
    agentOf(buildAgentConfig(input({ callPrefs: { transfer_number: "nonsense" } })))
      .prompt.built_in_tools.transfer_to_number,
    null,
  );
});

Deno.test("buildAgentConfig: a transfer number produces one normalized transfer", () => {
  const config = buildAgentConfig(
    input({ callPrefs: { transfer_number: "+1 (555) 000-0000" } }),
  );
  const tool = agentOf(config).prompt.built_in_tools.transfer_to_number!;

  assertEquals(tool.name, "transfer_to_number");
  assertEquals(tool.params.system_tool_type, "transfer_to_number");
  assertEquals(tool.params.transfers, [
    {
      transfer_destination: { type: "phone", phone_number: "+15550000000" },
      condition:
        "Caller asks for a person, is upset after two attempts, or has a request you cannot fulfil.",
      transfer_type: "conference",
    },
  ]);
});

Deno.test("buildAgentConfig: a distinct emergency number adds a second transfer", () => {
  const config = buildAgentConfig(
    input({
      callPrefs: {
        transfer_number: "+1 (555) 000-0000",
        emergency_number: "5551239999",
      },
    }),
  );
  const transfers = agentOf(config).prompt.built_in_tools.transfer_to_number!.params
    .transfers;

  assertEquals(transfers.length, 2);
  assertEquals(transfers[0].transfer_destination.phone_number, "+15550000000");
  assertEquals(
    transfers[0].condition,
    "Caller asks for a person, is upset after two attempts, or has a request you cannot fulfil.",
  );
  assertEquals(transfers[1].transfer_destination.phone_number, "+15551239999");
  assertEquals(transfers[1].condition, "Caller reports an emergency.");
});

Deno.test("buildAgentConfig: an identical emergency number is not duplicated", () => {
  const config = buildAgentConfig(
    input({
      callPrefs: {
        transfer_number: "+1 (555) 000-0000",
        emergency_number: "5550000000",
      },
    }),
  );
  const transfers = agentOf(config).prompt.built_in_tools.transfer_to_number!.params
    .transfers;

  assertEquals(transfers.length, 1);
  assertEquals(
    transfers[0].condition,
    "Caller asks for a person, is upset after two attempts, or has a request you cannot fulfil.",
  );
});

Deno.test("buildAgentConfig: an emergency number alone uses the general condition", () => {
  const config = buildAgentConfig(
    input({ callPrefs: { emergency_number: "5551239999" } }),
  );
  const transfers = agentOf(config).prompt.built_in_tools.transfer_to_number!.params
    .transfers;

  assertEquals(transfers.length, 1);
  assertEquals(transfers[0].transfer_destination.phone_number, "+15551239999");
  assertEquals(
    transfers[0].condition,
    "Caller asks for a person, is upset after two attempts, or has a request you cannot fulfil.",
  );
});

Deno.test("buildAgentConfig: voicemail detection is on by default and off when disabled", () => {
  assertEquals(
    agentOf(buildAgentConfig(input())).prompt.built_in_tools.voicemail_detection,
    {
      name: "voicemail_detection",
      description: "Detect voicemail and end the call politely.",
      params: { system_tool_type: "voicemail_detection" },
    },
  );

  assertEquals(
    agentOf(buildAgentConfig(input({ callPrefs: { voicemail_enabled: false } })))
      .prompt.built_in_tools.voicemail_detection,
    null,
  );

  assertEquals(
    agentOf(buildAgentConfig(input({ callPrefs: { voicemail_enabled: null } })))
      .prompt.built_in_tools.voicemail_detection !== null,
    true,
  );
});

// --- knowledge base ---

Deno.test("buildAgentConfig: maps knowledge base documents", () => {
  const config = buildAgentConfig(
    input({
      kbDocs: [
        { elevenlabs_document_id: "doc_1", filename: "pricing.pdf" },
        { elevenlabs_document_id: "doc_2", filename: "faq.md" },
      ],
    }),
  );

  assertEquals(agentOf(config).prompt.knowledge_base, [
    { type: "file", id: "doc_1", name: "pricing.pdf", usage_mode: "auto" },
    { type: "file", id: "doc_2", name: "faq.md", usage_mode: "auto" },
  ]);
});

Deno.test("buildAgentConfig: knowledge base is empty with no documents", () => {
  assertEquals(agentOf(buildAgentConfig(input())).prompt.knowledge_base, []);
});

// --- data collection ---

Deno.test("buildAgentConfig: merges template data collection over the defaults", () => {
  const config = buildAgentConfig(input());
  const collected = config.platform_settings!.data_collection as Record<
    string,
    { type: string; description: string }
  >;

  for (const key of Object.keys(DEFAULT_DATA_COLLECTION)) {
    assertEquals(typeof collected[key].type, "string");
  }
  assertEquals(Object.keys(DEFAULT_DATA_COLLECTION).length, 8);
  assertEquals(Object.keys(collected).length, 9);
  assertEquals(collected.company, { type: "string", description: "x" });
  assertEquals(collected.lead_score.type, "integer");
  assertEquals(collected.appointment_requested.type, "boolean");
});

Deno.test("buildAgentConfig: a template may override a default collection field", () => {
  const overriding = structuredClone(template);
  overriding.elevenlabs = {
    data_collection: { sentiment: { type: "string", description: "custom" } },
  };

  const collected = buildAgentConfig(input({ template: overriding }))
    .platform_settings!.data_collection as Record<string, { description: string }>;

  assertEquals(Object.keys(collected).length, 8);
  assertEquals(collected.sentiment.description, "custom");
});

// --- normalizePhone ---

Deno.test("normalizePhone: normalizes US and international numbers", () => {
  assertEquals(normalizePhone("5550000000"), "+15550000000");
  assertEquals(normalizePhone("+1 (555) 000-0000"), "+15550000000");
  assertEquals(normalizePhone("15550000000"), "+15550000000");
  assertEquals(normalizePhone("+442071234567"), "+442071234567");
});

Deno.test("normalizePhone: returns null for unusable input", () => {
  assertEquals(normalizePhone("abc"), null);
  assertEquals(normalizePhone(""), null);
  assertEquals(normalizePhone(undefined), null);
  assertEquals(normalizePhone(null), null);
  assertEquals(normalizePhone("12345"), null);
  assertEquals(normalizePhone("442071234567"), null);
  assertEquals(normalizePhone("+1234567890123456"), null);
});
