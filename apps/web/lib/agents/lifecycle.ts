export type AgentLifecycle =
  | "draft"
  | "ingesting"
  | "needs_review"
  | "testing"
  | "ready"
  | "live"
  | "paused"
  | "failed";

const transitions: Record<AgentLifecycle, AgentLifecycle[]> = {
  draft: ["ingesting", "failed"],
  ingesting: ["needs_review", "testing", "failed"],
  needs_review: ["ingesting", "testing", "failed"],
  testing: ["ready", "failed"],
  ready: ["live", "testing", "failed"],
  live: ["paused", "failed"],
  paused: ["live", "testing", "failed"],
  failed: ["draft", "ingesting", "testing"],
};

export function canTransition(from: AgentLifecycle, to: AgentLifecycle) {
  return transitions[from].includes(to);
}

export type ActivationEvidence = {
  overall_success: number;
  critical_passed: boolean;
  staff_test_passed: boolean;
  phone_number: string | null;
};

export function assertActivationReady(evidence: ActivationEvidence) {
  if (evidence.overall_success < 0.95) throw new Error("Automated simulations must reach at least 95% success");
  if (!evidence.critical_passed) throw new Error("Every critical simulation must pass");
  if (!evidence.staff_test_passed) throw new Error("A staff test call must pass before activation");
  if (!evidence.phone_number) throw new Error("Assign a Retell phone number before activation");
}
