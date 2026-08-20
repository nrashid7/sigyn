import assert from "node:assert/strict";
import test from "node:test";

import { knowledgeVoiceStatus } from "../apps/web/lib/knowledge/presentation.ts";

test("knowledge voice states distinguish publishing, availability, failure, and removal", () => {
  assert.deepEqual(knowledgeVoiceStatus("pending", null), {
    label: "Publishing",
    variant: "warning",
    retryable: false,
    terminal: false,
    detail: "Retell is preparing this source for calls.",
  });
  assert.equal(knowledgeVoiceStatus("syncing", null).label, "Publishing");
  assert.equal(knowledgeVoiceStatus("ready", null).label, "Available to calls");
  assert.equal(knowledgeVoiceStatus("ready", null).terminal, true);
  assert.equal(knowledgeVoiceStatus("deleting", null).label, "Removing");
  assert.equal(knowledgeVoiceStatus("failed", "Provider unavailable").retryable, true);
  assert.equal(knowledgeVoiceStatus("failed", "Provider unavailable").detail, "Provider unavailable");
});

test("knowledge failure details are bounded for customer display", () => {
  const state = knowledgeVoiceStatus("failed", "x".repeat(1_000));
  assert.ok(state.detail.length <= 240);
});
