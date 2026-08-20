import test from "node:test";
import assert from "node:assert/strict";
import { assertActivationReady, canTransition } from "../apps/web/lib/agents/lifecycle.ts";

test("agent lifecycle permits managed launch and pause transitions", () => {
  assert.equal(canTransition("draft", "ingesting"), true);
  assert.equal(canTransition("testing", "ready"), true);
  assert.equal(canTransition("ready", "live"), true);
  assert.equal(canTransition("live", "paused"), true);
  assert.equal(canTransition("draft", "live"), false);
  assert.equal(canTransition("testing", "live"), false);
});

test("activation requires simulations, critical cases, staff call, and assigned phone", () => {
  assert.doesNotThrow(() => assertActivationReady({
    overall_success: 0.95,
    critical_passed: true,
    staff_test_passed: true,
    phone_number: "+16125550123",
  }));
  assert.throws(() => assertActivationReady({
    overall_success: 0.94,
    critical_passed: true,
    staff_test_passed: true,
    phone_number: "+16125550123",
  }), /95%/);
  assert.throws(() => assertActivationReady({
    overall_success: 1,
    critical_passed: false,
    staff_test_passed: true,
    phone_number: "+16125550123",
  }), /critical/);
  assert.throws(() => assertActivationReady({
    overall_success: 1,
    critical_passed: true,
    staff_test_passed: false,
    phone_number: "+16125550123",
  }), /staff test call/);
  assert.throws(() => assertActivationReady({
    overall_success: 1,
    critical_passed: true,
    staff_test_passed: true,
    phone_number: null,
  }), /phone number/);
});
