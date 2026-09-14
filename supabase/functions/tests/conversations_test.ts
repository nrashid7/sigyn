import { assertEquals } from "jsr:@std/assert@1";
import type { ElConversation } from "../_shared/elevenlabs.ts";
import {
  type AgentRow,
  flattenDataCollection,
  isMissedCall,
  mapConversationToCallRow,
  mapTranscript,
} from "../_shared/conversations.ts";

const RAW_FIXTURE = await Deno.readTextFile(
  new URL("./fixtures/post_call_transcription.json", import.meta.url),
);
const ENVELOPE = JSON.parse(RAW_FIXTURE) as { data: ElConversation };

/** Fresh deep clone per test so mutations never leak between cases. */
function conversation(): ElConversation {
  return structuredClone(ENVELOPE.data);
}

const agent: AgentRow = { id: "a1", business_id: "b1" };

// --- baseline mapping from the real post_call_transcription payload ---

Deno.test("mapConversationToCallRow: maps the post_call_transcription fixture", () => {
  const row = mapConversationToCallRow(conversation(), agent);

  assertEquals(row.elevenlabs_conversation_id, "conv_test");
  assertEquals(row.business_id, "b1");
  assertEquals(row.agent_id, "a1");
  assertEquals(row.caller_number, "+15550002222");
  assertEquals(row.duration_seconds, 95);
  assertEquals(row.status, "completed");
  assertEquals(row.outcome, "booked");
  assertEquals(row.sentiment, "positive");
  assertEquals(row.lead_score, 0);
  // 1757799000 unix == 2025-09-13T21:30:00Z; ended_at is start + 95s.
  assertEquals(row.started_at, "2025-09-13T21:30:00.000Z");
  assertEquals(row.ended_at, "2025-09-13T21:31:35.000Z");
  assertEquals(
    new Date(row.ended_at!).getTime() - new Date(row.started_at!).getTime(),
    95_000,
  );
  assertEquals(row.qualification_data, {
    outcome: "booked",
    lead_score: 0,
    sentiment: "positive",
    customer_name: "Jane Doe",
  });
  assertEquals(row.provider_metadata, {
    status: "done",
    termination_reason: "end_call tool was called",
    call_successful: "success",
    phone_call: {
      type: "twilio",
      direction: "inbound",
      agent_number: "+15550001111",
      external_number: "+15550002222",
      call_sid: "CA123",
    },
  });
});

Deno.test("mapConversationToCallRow: omits provider_metadata keys that are absent", () => {
  const conv = conversation();
  delete conv.metadata!.termination_reason;
  delete conv.metadata!.phone_call;
  delete conv.analysis!.call_successful;

  const row = mapConversationToCallRow(conv, agent);
  assertEquals(row.provider_metadata, { status: "done" });
  assertEquals(Object.keys(row.provider_metadata), ["status"]);
});

Deno.test("mapConversationToCallRow: includes cost when ElevenLabs reports it", () => {
  const conv = conversation();
  conv.metadata!.cost = 42;

  const row = mapConversationToCallRow(conv, agent);
  assertEquals(row.provider_metadata.cost, 42);
});

// --- mapTranscript ---

Deno.test("mapTranscript: maps roles, contents and timestamps", () => {
  const transcript = mapTranscript(conversation());

  assertEquals(transcript.length, 2);
  assertEquals(transcript.map((t) => t.role), ["agent", "user"]);
  assertEquals(transcript.map((t) => t.content), [
    "Hi, thanks for calling Acme.",
    "I want to book a haircut.",
  ]);
  assertEquals(transcript.map((t) => t.timestamp), [0, 3]);
});

Deno.test("mapTranscript: drops empty messages and defaults a missing timestamp to 0", () => {
  const conv = conversation();
  conv.transcript = [
    { role: "agent", message: "Hello." },
    { role: "agent", message: null },
    { role: "user", message: "" },
    { role: "tool", message: "Tool spoke." },
  ];

  assertEquals(mapTranscript(conv), [
    { role: "agent", content: "Hello.", timestamp: 0 },
    { role: "user", content: "Tool spoke.", timestamp: 0 },
  ]);
});

Deno.test("mapTranscript: returns an empty array when there is no transcript", () => {
  const conv = conversation();
  delete conv.transcript;
  assertEquals(mapTranscript(conv), []);
});

// --- flattenDataCollection ---

Deno.test("flattenDataCollection: flattens id -> value", () => {
  assertEquals(flattenDataCollection(conversation()), {
    outcome: "booked",
    lead_score: 0,
    sentiment: "positive",
    customer_name: "Jane Doe",
  });
});

Deno.test("flattenDataCollection: skips null and undefined values", () => {
  const conv = conversation();
  conv.analysis!.data_collection_results = {
    customer_name: { data_collection_id: "customer_name", value: "Jane Doe" },
    customer_email: { data_collection_id: "customer_email", value: null },
    customer_phone: { data_collection_id: "customer_phone" },
    appointment_requested: {
      data_collection_id: "appointment_requested",
      value: false,
    },
  };

  assertEquals(flattenDataCollection(conv), {
    customer_name: "Jane Doe",
    appointment_requested: false,
  });
});

Deno.test("flattenDataCollection: returns an empty object with no analysis", () => {
  const conv = conversation();
  delete conv.analysis;
  assertEquals(flattenDataCollection(conv), {});
});

// --- status precedence ---

Deno.test("mapConversationToCallRow: a transfer termination reason wins over conversation status", () => {
  const conv = conversation();
  conv.metadata!.termination_reason = "transfer to +15551234567 completed";

  const row = mapConversationToCallRow(conv, agent);
  assertEquals(row.status, "transferred");
  assertEquals(row.outcome, "transferred");
});

Deno.test("mapConversationToCallRow: a failed conversation is failed/missed", () => {
  const conv = conversation();
  conv.status = "failed";
  // A failed call never produces data collection results.
  delete conv.analysis!.data_collection_results;

  const row = mapConversationToCallRow(conv, agent);
  assertEquals(row.status, "failed");
  assertEquals(row.outcome, "missed");
  assertEquals(row.lead_score, null);
  assertEquals(row.sentiment, null);
});

Deno.test("mapConversationToCallRow: a done conversation with zero duration is no_answer/missed", () => {
  const conv = conversation();
  conv.metadata!.call_duration_secs = 0;
  delete conv.analysis!.data_collection_results;

  const row = mapConversationToCallRow(conv, agent);
  assertEquals(row.status, "no_answer");
  assertEquals(row.outcome, "missed");
  assertEquals(row.duration_seconds, 0);
  // ended_at still derives from started_at, with a zero-second call.
  assertEquals(row.ended_at, row.started_at);
});

Deno.test("mapConversationToCallRow: an unfinished conversation is in_progress with no outcome", () => {
  for (const status of ["initiated", "in-progress", "processing"]) {
    const conv = conversation();
    conv.status = status;
    delete conv.analysis!.data_collection_results;

    const row = mapConversationToCallRow(conv, agent);
    assertEquals(row.status, "in_progress");
    assertEquals(row.outcome, null);
  }
});

Deno.test("mapConversationToCallRow: defaults duration to 0 when metadata is missing", () => {
  const conv = conversation();
  delete conv.metadata;

  const row = mapConversationToCallRow(conv, agent);
  assertEquals(row.duration_seconds, 0);
  assertEquals(row.started_at, null);
  assertEquals(row.ended_at, null);
});

// --- outcome precedence ---

Deno.test("mapConversationToCallRow: an existing qualified_lead outcome beats the collected outcome", () => {
  const conv = conversation();
  conv.analysis!.data_collection_results!.outcome.value = "answered";

  const row = mapConversationToCallRow(conv, agent, {
    id: "c1",
    outcome: "qualified_lead",
  });
  assertEquals(row.outcome, "qualified_lead");
});

Deno.test("mapConversationToCallRow: a booked appointment beats every other outcome", () => {
  const conv = conversation();
  conv.analysis!.data_collection_results!.outcome.value = "answered";

  const row = mapConversationToCallRow(conv, agent, {
    id: "c1",
    outcome: "qualified_lead",
    has_appointment: true,
  });
  assertEquals(row.outcome, "booked");
});

Deno.test("mapConversationToCallRow: the collected outcome beats the status-derived fallback", () => {
  const conv = conversation();
  conv.analysis!.data_collection_results!.outcome.value = "voicemail";

  const row = mapConversationToCallRow(conv, agent);
  assertEquals(row.status, "completed");
  assertEquals(row.outcome, "voicemail");
});

Deno.test("mapConversationToCallRow: an unrecognised collected outcome falls back to the status", () => {
  const conv = conversation();
  conv.analysis!.data_collection_results!.outcome.value = "not_an_enum_value";

  const row = mapConversationToCallRow(conv, agent);
  assertEquals(row.outcome, "answered");
});

// --- sentiment ---

Deno.test("mapConversationToCallRow: an off-enum sentiment becomes null", () => {
  const conv = conversation();
  conv.analysis!.data_collection_results!.sentiment.value = "meh";

  const row = mapConversationToCallRow(conv, agent);
  assertEquals(row.sentiment, null);
});

Deno.test("mapConversationToCallRow: accepts each valid sentiment", () => {
  for (const sentiment of ["positive", "neutral", "negative"]) {
    const conv = conversation();
    conv.analysis!.data_collection_results!.sentiment.value = sentiment;
    assertEquals(mapConversationToCallRow(conv, agent).sentiment, sentiment);
  }
});

// --- lead score ---

Deno.test("mapConversationToCallRow: clamps a collected lead score to 0-100", () => {
  const conv = conversation();
  conv.analysis!.data_collection_results!.lead_score.value = "150";
  assertEquals(mapConversationToCallRow(conv, agent).lead_score, 100);

  conv.analysis!.data_collection_results!.lead_score.value = -20;
  assertEquals(mapConversationToCallRow(conv, agent).lead_score, 0);

  conv.analysis!.data_collection_results!.lead_score.value = 72.6;
  assertEquals(mapConversationToCallRow(conv, agent).lead_score, 73);
});

Deno.test("mapConversationToCallRow: a non-numeric lead score becomes null", () => {
  const conv = conversation();
  conv.analysis!.data_collection_results!.lead_score.value = "high";
  assertEquals(mapConversationToCallRow(conv, agent).lead_score, null);
});

Deno.test("mapConversationToCallRow: an existing lead score wins over the collected one", () => {
  const conv = conversation();
  conv.analysis!.data_collection_results!.lead_score.value = 10;

  const row = mapConversationToCallRow(conv, agent, { id: "c1", lead_score: 88 });
  assertEquals(row.lead_score, 88);
});

// --- caller number precedence ---

Deno.test("mapConversationToCallRow: falls back to the system__caller_id dynamic variable", () => {
  const conv = conversation();
  delete conv.metadata!.phone_call;
  conv.conversation_initiation_client_data = {
    dynamic_variables: { system__caller_id: "+15550003333" },
  };

  assertEquals(mapConversationToCallRow(conv, agent).caller_number, "+15550003333");
});

Deno.test("mapConversationToCallRow: falls back to the caller number already on the row", () => {
  const conv = conversation();
  delete conv.metadata!.phone_call;

  const row = mapConversationToCallRow(conv, agent, {
    id: "c1",
    caller_number: "+15559998888",
  });
  assertEquals(row.caller_number, "+15559998888");
});

Deno.test("mapConversationToCallRow: caller number is null when nothing supplies one", () => {
  const conv = conversation();
  delete conv.metadata!.phone_call;

  assertEquals(mapConversationToCallRow(conv, agent).caller_number, null);
});

Deno.test("mapConversationToCallRow: the ElevenLabs external number wins over both fallbacks", () => {
  const conv = conversation();
  conv.conversation_initiation_client_data = {
    dynamic_variables: { system__caller_id: "+15550003333" },
  };

  const row = mapConversationToCallRow(conv, agent, {
    id: "c1",
    caller_number: "+15559998888",
  });
  assertEquals(row.caller_number, "+15550002222");
});

// --- qualification data ---

Deno.test("mapConversationToCallRow: merges collected data over existing qualification data", () => {
  const conv = conversation();

  const row = mapConversationToCallRow(conv, agent, {
    id: "c1",
    qualification_data: { budget: "5000", sentiment: "negative" },
  });
  assertEquals(row.qualification_data, {
    budget: "5000",
    outcome: "booked",
    lead_score: 0,
    sentiment: "positive",
    customer_name: "Jane Doe",
  });
});

// --- isMissedCall ---

Deno.test("isMissedCall: false for a conversation the agent spoke on", () => {
  assertEquals(isMissedCall(conversation()), false);
});

Deno.test("isMissedCall: true for a failed conversation", () => {
  const conv = conversation();
  conv.status = "failed";
  assertEquals(isMissedCall(conv), true);
});

Deno.test("isMissedCall: true when only the caller ever spoke", () => {
  const conv = conversation();
  conv.transcript = [
    { role: "user", message: "Hello?", time_in_call_secs: 0 },
    { role: "user", message: "Anyone there?", time_in_call_secs: 4 },
  ];
  assertEquals(isMissedCall(conv), true);
});

Deno.test("isMissedCall: true when the agent turn has no message", () => {
  const conv = conversation();
  conv.transcript = [{ role: "agent", message: "", time_in_call_secs: 0 }];
  assertEquals(isMissedCall(conv), true);
});

Deno.test("isMissedCall: true when there is no transcript at all", () => {
  const conv = conversation();
  delete conv.transcript;
  assertEquals(isMissedCall(conv), true);
});
