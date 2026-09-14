import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { TOOL_HEADER, TOOL_NAMES, toolDefinitions } from "./lib/tool-definitions.mjs";

const SUPABASE_URL = "https://x.supabase.co";
const SECRET_ID = "sec_1";

const FUNCTION_BY_TOOL_NAME = {
  check_availability: "calendar-availability",
  book_appointment: "calendar-book",
  qualify_lead: "qualify-lead",
};

test("toolDefinitions returns one tool_config per TOOL_NAMES entry, in order", () => {
  const defs = toolDefinitions(SUPABASE_URL, SECRET_ID);
  assert.equal(defs.length, 3);
  assert.deepEqual(
    defs.map((d) => d.tool_config.name),
    TOOL_NAMES,
  );
});

test("each tool_config posts to the right Supabase function", () => {
  const defs = toolDefinitions(SUPABASE_URL, SECRET_ID);
  for (const { tool_config } of defs) {
    const fn = FUNCTION_BY_TOOL_NAME[tool_config.name];
    assert.equal(tool_config.api_schema.url, `${SUPABASE_URL}/functions/v1/${fn}`);
    assert.equal(tool_config.api_schema.method, "POST");
  }
});

test("each tool_config authenticates its header with the shared secret_id", () => {
  const defs = toolDefinitions(SUPABASE_URL, SECRET_ID);
  for (const { tool_config } of defs) {
    assert.deepEqual(tool_config.api_schema.request_headers[TOOL_HEADER], {
      secret_id: SECRET_ID,
    });
  }
});

test("every request_body_schema property has exactly one value source", () => {
  const defs = toolDefinitions(SUPABASE_URL, SECRET_ID);
  for (const { tool_config } of defs) {
    const { properties } = tool_config.api_schema.request_body_schema;
    for (const [propName, prop] of Object.entries(properties)) {
      const sources = ["description", "dynamic_variable", "constant_value"].filter(
        (key) => key in prop,
      );
      assert.equal(
        sources.length,
        1,
        `${tool_config.name}.${propName} should have exactly one of description/dynamic_variable/constant_value, found: ${sources.join(",") || "none"}`,
      );
    }
  }
});

test("agent_id and conversation_id use the system__ dynamic variables", () => {
  const defs = toolDefinitions(SUPABASE_URL, SECRET_ID);
  for (const { tool_config } of defs) {
    const { properties } = tool_config.api_schema.request_body_schema;
    assert.equal(properties.agent_id.dynamic_variable, "system__agent_id");
    assert.equal(properties.conversation_id.dynamic_variable, "system__conversation_id");
  }
});

test("required + property names match the shared expected_tool_params.json fixture", () => {
  const expected = JSON.parse(
    readFileSync("supabase/functions/tests/fixtures/expected_tool_params.json", "utf8"),
  );
  const defs = toolDefinitions(SUPABASE_URL, SECRET_ID);

  for (const { tool_config } of defs) {
    const expectedTool = expected[tool_config.name];
    assert.ok(expectedTool, `expected_tool_params.json is missing an entry for ${tool_config.name}`);

    const { required, properties } = tool_config.api_schema.request_body_schema;
    assert.deepEqual([...required].sort(), [...expectedTool.required].sort());
    assert.deepEqual(
      Object.keys(properties).sort(),
      Object.keys(expectedTool.properties).sort(),
    );
  }
});

test("--dry-run exits 0, makes no network calls, and prints the tool names + supabase secrets set command", () => {
  const env = { ...process.env, SUPABASE_URL };
  delete env.ELEVENLABS_API_KEY;

  const result = spawnSync(process.execPath, ["scripts/elevenlabs-setup.mjs", "--dry-run"], {
    env,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  for (const name of TOOL_NAMES) {
    assert.match(result.stdout, new RegExp(name));
  }
  assert.match(result.stdout, /supabase secrets set/);
});

test("--dry-run --env-out writes a dotenv line with the three tool ids", () => {
  const dir = mkdtempSync(join(tmpdir(), "elevenlabs-setup-"));
  const envOutPath = join(dir, "elevenlabs.env");
  try {
    const env = { ...process.env, SUPABASE_URL };
    delete env.ELEVENLABS_API_KEY;
    delete env.CI;

    const result = spawnSync(
      process.execPath,
      ["scripts/elevenlabs-setup.mjs", "--dry-run", "--env-out", envOutPath],
      { env, encoding: "utf8" },
    );

    assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);

    const contents = readFileSync(envOutPath, "utf8");
    const lines = contents.split("\n").filter((line) => line.length > 0);
    assert.equal(lines.length, 1, `expected exactly one line, got:\n${contents}`);
    assert.match(lines[0], /^ELEVENLABS_TOOL_IDS='\{/);

    const json = lines[0].slice("ELEVENLABS_TOOL_IDS=".length).replace(/^'|'$/g, "");
    const parsed = JSON.parse(json);
    assert.deepEqual(Object.keys(parsed).sort(), [...TOOL_NAMES].sort());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CI=true --dry-run without the tool/webhook secrets exits 1 and names both missing vars", () => {
  const env = { ...process.env, SUPABASE_URL, CI: "true" };
  delete env.ELEVENLABS_API_KEY;
  delete env.ELEVENLABS_TOOL_SECRET;
  delete env.ELEVENLABS_WEBHOOK_SECRET;

  const result = spawnSync(process.execPath, ["scripts/elevenlabs-setup.mjs", "--dry-run"], {
    env,
    encoding: "utf8",
  });

  assert.equal(result.status, 1, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(result.stderr, /ELEVENLABS_TOOL_SECRET/);
  assert.match(result.stderr, /ELEVENLABS_WEBHOOK_SECRET/);
});

test("CI=true with both secrets set never prints the secret values", () => {
  const dir = mkdtempSync(join(tmpdir(), "elevenlabs-setup-"));
  const envOutPath = join(dir, "elevenlabs.env");
  const dummyToolSecret = "dummy-tool-secret-value";
  const dummyWebhookSecret = "dummy-webhook-secret-value";
  try {
    const env = {
      ...process.env,
      SUPABASE_URL,
      CI: "true",
      ELEVENLABS_TOOL_SECRET: dummyToolSecret,
      ELEVENLABS_WEBHOOK_SECRET: dummyWebhookSecret,
    };
    delete env.ELEVENLABS_API_KEY;

    const result = spawnSync(
      process.execPath,
      ["scripts/elevenlabs-setup.mjs", "--dry-run", "--env-out", envOutPath],
      { env, encoding: "utf8" },
    );

    assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.doesNotMatch(result.stdout, new RegExp(dummyToolSecret));
    assert.doesNotMatch(result.stdout, new RegExp(dummyWebhookSecret));
    assert.doesNotMatch(result.stderr, new RegExp(dummyToolSecret));
    assert.doesNotMatch(result.stderr, new RegExp(dummyWebhookSecret));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
