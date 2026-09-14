import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { AppError } from "../_shared/errors.ts";
import { includeCalendarOf, loadToolIds } from "../_shared/agent-config.ts";
import {
  areaCodeFrom,
  isProvisioningInProgress,
  isUniqueViolation,
  nextStep,
  type ProvisionCheckpointRow,
  type ProvisioningHeartbeatRow,
} from "../agent-provision/steps.ts";

function checkpointRow(
  overrides: Partial<ProvisionCheckpointRow> = {},
): ProvisionCheckpointRow {
  return {
    provision_status: "provisioning",
    elevenlabs_agent_id: null,
    phone_number: null,
    elevenlabs_phone_number_id: null,
    ...overrides,
  };
}

// --- areaCodeFrom ---

Deno.test("areaCodeFrom: pulls the area code out of a formatted US number", () => {
  assertEquals(areaCodeFrom("+1 (612) 555-0100"), "612");
});

Deno.test("areaCodeFrom: pulls the area code out of a bare 10-digit number", () => {
  assertEquals(areaCodeFrom("6125550100"), "612");
});

Deno.test("areaCodeFrom: passes a 3-digit area code straight through", () => {
  assertEquals(areaCodeFrom("612"), "612");
});

Deno.test("areaCodeFrom: accepts a number as well as a string", () => {
  assertEquals(areaCodeFrom(612), "612");
  assertEquals(areaCodeFrom(6125550100), "612");
});

Deno.test("areaCodeFrom: returns undefined when there is no usable area code", () => {
  assertEquals(areaCodeFrom("abc"), undefined);
  assertEquals(areaCodeFrom(""), undefined);
  assertEquals(areaCodeFrom(undefined), undefined);
  assertEquals(areaCodeFrom(null), undefined);
  assertEquals(areaCodeFrom("12345"), undefined);
  // Non-US numbers have no 3-digit US area code to search on.
  assertEquals(areaCodeFrom("+44 20 7123 4567"), undefined);
});

// --- nextStep ---

Deno.test("nextStep: a row with no external ids starts at create_agent", () => {
  assertEquals(nextStep(checkpointRow()), "create_agent");
});

Deno.test("nextStep: an agent without a number resumes at acquire_number", () => {
  assertEquals(
    nextStep(checkpointRow({ elevenlabs_agent_id: "agent_1" })),
    "acquire_number",
  );
});

Deno.test("nextStep: a number that is not imported yet resumes at import_number", () => {
  assertEquals(
    nextStep(
      checkpointRow({ elevenlabs_agent_id: "agent_1", phone_number: "+16125550100" }),
    ),
    "import_number",
  );
});

Deno.test("nextStep: every id present resumes at assign_and_finish", () => {
  assertEquals(
    nextStep(
      checkpointRow({
        elevenlabs_agent_id: "agent_1",
        phone_number: "+16125550100",
        elevenlabs_phone_number_id: "pn_1",
      }),
    ),
    "assign_and_finish",
  );
});

Deno.test("nextStep: a ready row is done", () => {
  assertEquals(
    nextStep(
      checkpointRow({
        provision_status: "ready",
        elevenlabs_agent_id: "agent_1",
        phone_number: "+16125550100",
        elevenlabs_phone_number_id: "pn_1",
      }),
    ),
    "done",
  );
});

Deno.test("nextStep: a failed row resumes at its first incomplete step", () => {
  assertEquals(
    nextStep(
      checkpointRow({ provision_status: "failed", elevenlabs_agent_id: "agent_1" }),
    ),
    "acquire_number",
  );
  assertEquals(
    nextStep(checkpointRow({ provision_status: "failed" })),
    "create_agent",
  );
});

// --- isProvisioningInProgress ---

const NOW = new Date("2026-09-14T12:00:00.000Z");

function heartbeatRow(
  status: string,
  ageSeconds: number,
): ProvisioningHeartbeatRow {
  return {
    provision_status: status,
    updated_at: new Date(NOW.getTime() - ageSeconds * 1000).toISOString(),
  };
}

Deno.test("isProvisioningInProgress: true for a provisioning row touched seconds ago", () => {
  assertEquals(isProvisioningInProgress(heartbeatRow("provisioning", 30), NOW), true);
});

Deno.test("isProvisioningInProgress: false once the row goes stale", () => {
  assertEquals(isProvisioningInProgress(heartbeatRow("provisioning", 180), NOW), false);
});

Deno.test("isProvisioningInProgress: the 2 minute window is exclusive at its edge", () => {
  assertEquals(isProvisioningInProgress(heartbeatRow("provisioning", 119), NOW), true);
  assertEquals(isProvisioningInProgress(heartbeatRow("provisioning", 120), NOW), false);
});

Deno.test("isProvisioningInProgress: false for any other status", () => {
  assertEquals(isProvisioningInProgress(heartbeatRow("ready", 10), NOW), false);
  assertEquals(isProvisioningInProgress(heartbeatRow("failed", 10), NOW), false);
});

Deno.test("isProvisioningInProgress: false when updated_at is missing or unusable", () => {
  assertEquals(
    isProvisioningInProgress({ provision_status: "provisioning", updated_at: null }, NOW),
    false,
  );
  assertEquals(
    isProvisioningInProgress(
      { provision_status: "provisioning", updated_at: "not a date" },
      NOW,
    ),
    false,
  );
});

// --- loadToolIds ---

const VALID_TOOL_IDS = {
  check_availability: "tool_avail",
  book_appointment: "tool_book",
  qualify_lead: "tool_qualify",
};

function withToolIdsEnv(raw: string | undefined, run: () => void): void {
  if (raw === undefined) {
    Deno.env.delete("ELEVENLABS_TOOL_IDS");
  } else {
    Deno.env.set("ELEVENLABS_TOOL_IDS", raw);
  }
  try {
    run();
  } finally {
    Deno.env.delete("ELEVENLABS_TOOL_IDS");
  }
}

function assertConfigError(raw: string | undefined): void {
  withToolIdsEnv(raw, () => {
    const err = assertThrows(() => loadToolIds(), AppError);
    assertEquals(err.code, "CONFIG_ERROR");
    assertEquals(err.statusCode, 500);
  });
}

Deno.test("loadToolIds: parses the three tool ids", () => {
  withToolIdsEnv(JSON.stringify(VALID_TOOL_IDS), () => {
    assertEquals(loadToolIds(), VALID_TOOL_IDS);
  });
});

Deno.test("loadToolIds: ignores unknown keys in the secret", () => {
  withToolIdsEnv(JSON.stringify({ ...VALID_TOOL_IDS, transfer_call: "tool_x" }), () => {
    assertEquals(loadToolIds(), VALID_TOOL_IDS);
  });
});

Deno.test("loadToolIds: throws CONFIG_ERROR when a tool id is missing", () => {
  assertConfigError(
    JSON.stringify({
      check_availability: "tool_avail",
      book_appointment: "tool_book",
    }),
  );
});

Deno.test("loadToolIds: throws CONFIG_ERROR when a tool id is blank or not a string", () => {
  assertConfigError(JSON.stringify({ ...VALID_TOOL_IDS, qualify_lead: "" }));
  assertConfigError(JSON.stringify({ ...VALID_TOOL_IDS, qualify_lead: 7 }));
  assertConfigError(JSON.stringify({ ...VALID_TOOL_IDS, qualify_lead: null }));
});

Deno.test("loadToolIds: throws CONFIG_ERROR on invalid JSON", () => {
  assertConfigError("not json");
  assertConfigError("[]");
  assertConfigError("null");
  assertConfigError('"tool_avail"');
});

Deno.test("loadToolIds: throws CONFIG_ERROR when the secret is unset", () => {
  assertConfigError(undefined);
});

// --- includeCalendarOf ---

Deno.test("includeCalendarOf: true when the config says true", () => {
  assertEquals(includeCalendarOf({ include_calendar: true }), true);
});

Deno.test("includeCalendarOf: false when the config says false", () => {
  assertEquals(includeCalendarOf({ include_calendar: false }), false);
});

Deno.test("includeCalendarOf: defaults to true for a JSON null", () => {
  assertEquals(includeCalendarOf({ include_calendar: null }), true);
});

Deno.test("includeCalendarOf: defaults to true when the key is missing", () => {
  assertEquals(includeCalendarOf({}), true);
});

// --- isUniqueViolation ---

Deno.test("isUniqueViolation: true for Postgres's unique-violation code", () => {
  assertEquals(isUniqueViolation({ code: "23505" }), true);
});

Deno.test("isUniqueViolation: false for a different error code", () => {
  assertEquals(isUniqueViolation({ code: "23503" }), false);
  assertEquals(isUniqueViolation({ code: "P0001" }), false);
});

Deno.test("isUniqueViolation: false when there is no error", () => {
  assertEquals(isUniqueViolation(null), false);
  assertEquals(isUniqueViolation(undefined), false);
  assertEquals(isUniqueViolation({ code: undefined }), false);
  assertEquals(isUniqueViolation({}), false);
});
