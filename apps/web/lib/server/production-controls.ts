export type ProductionOperation = "signup" | "agent_provisioning" | "billing" | "automation_dispatch";

export interface ProductionControls {
  signup_enabled: boolean;
  agent_provisioning_enabled: boolean;
  billing_enabled: boolean;
  automation_dispatch_enabled: boolean;
}

const MESSAGES: Record<ProductionOperation, string> = {
  signup: "New beta signups are temporarily paused",
  agent_provisioning: "Agent provisioning is temporarily paused",
  billing: "Billing changes are temporarily paused",
  automation_dispatch: "Automation dispatch is temporarily paused",
};

export function evaluateControl(operation: ProductionOperation, controls: ProductionControls | null) {
  const key = `${operation}_enabled` as keyof ProductionControls;
  return controls?.[key] === true ? { enabled: true as const } : {
    enabled: false as const,
    message: MESSAGES[operation],
  };
}
