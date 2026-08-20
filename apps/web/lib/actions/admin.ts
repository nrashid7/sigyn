"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "./auth";
import { getSupabaseServiceRoleKey } from "@/lib/supabase/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireServerEnv } from "@/lib/server/env";
import { assertActivationReady } from "@/lib/agents/lifecycle";
import { enforceRateLimit, requireProductionOperation } from "@/lib/server/production-service";

async function requireAdmin() {
  const profile = await getProfile();
  if (profile?.role !== "admin") throw new Error("Administrator access required");
  return profile;
}

export async function getAdminStats() {
  await requireAdmin();
  const supabase = await createClient();

  const [businesses, agents, callsToday, users] = await Promise.all([
    supabase.from("businesses").select("id", { count: "exact", head: true }),
    supabase.from("agents").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase
      .from("calls")
      .select("id", { count: "exact", head: true })
      .gte("created_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
    supabase.from("profiles").select("id", { count: "exact", head: true }),
  ]);

  return {
    totalBusinesses: businesses.count ?? 0,
    activeAgents: agents.count ?? 0,
    callsToday: callsToday.count ?? 0,
    totalUsers: users.count ?? 0,
  };
}

export async function getAdminBusinesses() {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase
    .from("businesses")
    .select("id, name, industry, onboarding_complete, created_at, agents(count)")
    .order("created_at", { ascending: false })
    .limit(50);
  return data ?? [];
}

export async function getAdminRecentCalls() {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase
    .from("calls")
    .select("id, caller_number, status, duration_seconds, created_at, businesses(name)")
    .order("created_at", { ascending: false })
    .limit(10);
  return data ?? [];
}

export async function getAdminTemplates() {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase
    .from("agent_templates")
    .select("*")
    .order("name");
  return data ?? [];
}

export async function getAdminFacts() {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("business_facts")
    .select("id,business_id,category,fact_key,value,source_url,confidence,review_status,observed_at,businesses(name)")
    .in("review_status", ["proposed", "stale"])
    .order("confidence", { ascending: false })
    .limit(250);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function reviewBusinessFact(formData: FormData) {
  const profile = await requireAdmin();
  const factId = String(formData.get("fact_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!factId || !["approved", "rejected"].includes(decision)) {
    throw new Error("Invalid review action");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("business_facts").update({
    review_status: decision,
    reviewed_by: profile.id,
    reviewed_at: new Date().toISOString(),
  }).eq("id", factId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/facts");
  revalidatePath("/dashboard/knowledge");
}

export async function getAdminAgentDeployments() {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.from("agents")
    .select("id,business_id,name,lifecycle_status,retell_agent_id,retell_knowledge_base_id,phone_number,last_error,businesses(name),agent_templates(slug,name),agent_deployments(id,deployment_version,lifecycle_status,test_result,created_at)")
    .order("hired_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function updateRetellPhone(phoneNumber: string, agentId: string | null) {
  const response = await fetch(`https://api.retellai.com/update-phone-number/${encodeURIComponent(phoneNumber)}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${requireServerEnv("RETELL_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inbound_agents: agentId ? [{ agent_id: agentId, agent_version: 1, weight: 1 }] : [],
      outbound_agents: agentId ? [{ agent_id: agentId, agent_version: 1, weight: 1 }] : [],
    }),
  });
  if (!response.ok) throw new Error(`Retell rejected the phone assignment (${response.status})`);
}

export async function recordAgentLaunchTests(formData: FormData) {
  await requireAdmin();
  const agentId = String(formData.get("agent_id") ?? "");
  const overallSuccess = Number(formData.get("overall_success"));
  const criticalPassed = formData.get("critical_passed") === "on";
  const staffTestPassed = formData.get("staff_test_passed") === "on";
  if (!agentId || !Number.isFinite(overallSuccess) || overallSuccess < 0 || overallSuccess > 1) {
    throw new Error("Enter an overall success rate between 0 and 1");
  }
  assertActivationReady({ overall_success: overallSuccess, critical_passed: criticalPassed, staff_test_passed: staffTestPassed, phone_number: "+10000000000" });

  const admin = createAdminClient();
  const { data: deployment } = await admin.from("agent_deployments")
    .select("id").eq("agent_id", agentId).order("deployment_version", { ascending: false }).limit(1).single();
  if (!deployment) throw new Error("Provision this agent before recording launch tests");
  const evidence = { overall_success: overallSuccess, critical_passed: criticalPassed, staff_test_passed: staffTestPassed, recorded_at: new Date().toISOString() };
  const { error } = await admin.from("agent_deployments").update({ test_result: evidence, lifecycle_status: "ready" }).eq("id", deployment.id);
  if (error) throw new Error(error.message);
  await admin.from("agents").update({ lifecycle_status: "ready", last_error: null }).eq("id", agentId);
  revalidatePath("/admin/agents");
}

export async function activateAgent(formData: FormData) {
  await requireAdmin();
  const agentId = String(formData.get("agent_id") ?? "");
  const phoneNumber = String(formData.get("phone_number") ?? "").trim();
  if (!/^\+[1-9]\d{7,14}$/.test(phoneNumber)) throw new Error("Enter a purchased Retell phone number in E.164 format");
  const admin = createAdminClient();
  const { data: agent } = await admin.from("agents").select("id,retell_agent_id,lifecycle_status").eq("id", agentId).single();
  const { data: deployment } = await admin.from("agent_deployments").select("id,test_result").eq("agent_id", agentId).order("deployment_version", { ascending: false }).limit(1).single();
  if (!agent?.retell_agent_id || !deployment) throw new Error("Provision this agent before activation");
  const evidence = deployment.test_result as { overall_success?: number; critical_passed?: boolean; staff_test_passed?: boolean };
  assertActivationReady({ overall_success: evidence.overall_success ?? 0, critical_passed: evidence.critical_passed === true, staff_test_passed: evidence.staff_test_passed === true, phone_number: phoneNumber });
  await updateRetellPhone(phoneNumber, agent.retell_agent_id);
  const now = new Date().toISOString();
  await admin.from("agent_deployments").update({ lifecycle_status: "live", activated_at: now }).eq("id", deployment.id);
  await admin.from("agents").update({ lifecycle_status: "live", is_active: true, phone_number: phoneNumber, last_error: null }).eq("id", agentId);
  revalidatePath("/admin/agents");
}

export async function pauseAgent(formData: FormData) {
  await requireAdmin();
  const agentId = String(formData.get("agent_id") ?? "");
  const admin = createAdminClient();
  const { data: agent } = await admin.from("agents").select("phone_number").eq("id", agentId).single();
  if (agent?.phone_number) await updateRetellPhone(agent.phone_number, null);
  await admin.from("agents").update({ lifecycle_status: "paused", is_active: false }).eq("id", agentId);
  revalidatePath("/admin/agents");
}

export async function rollbackAgent(formData: FormData) {
  await requireAdmin();
  const agentId = String(formData.get("agent_id") ?? "");
  const admin = createAdminClient();
  const { data: agent } = await admin.from("agents").select("phone_number").eq("id", agentId).single();
  const { data: deployments } = await admin.from("agent_deployments")
    .select("id,retell_agent_id,retell_llm_id,retell_knowledge_base_id,deployment_version")
    .eq("agent_id", agentId).order("deployment_version", { ascending: false }).limit(2);
  const prior = deployments?.[1];
  if (!prior?.retell_agent_id) throw new Error("No earlier deployment is available for rollback");
  if (agent?.phone_number) await updateRetellPhone(agent.phone_number, prior.retell_agent_id);
  await admin.from("agent_deployments").update({ lifecycle_status: "live", activated_at: new Date().toISOString() }).eq("id", prior.id);
  await admin.from("agents").update({
    retell_agent_id: prior.retell_agent_id,
    retell_llm_id: prior.retell_llm_id,
    retell_knowledge_base_id: prior.retell_knowledge_base_id,
    deployment_version: prior.deployment_version,
    lifecycle_status: "live",
    is_active: true,
    last_error: null,
  }).eq("id", agentId);
  revalidatePath("/admin/agents");
}

export async function provisionAgent(formData: FormData) {
  await requireAdmin();
  const localAgentId = String(formData.get("agent_id") ?? "");
  if (!localAgentId) throw new Error("Agent is required");
  await requireProductionOperation("agent_provisioning");
  const supabase = await createClient();
  const { data: agent } = await supabase.from("agents")
    .select("id,business_id,name,voice_id,voice_provider,agent_templates(slug)")
    .eq("id", localAgentId).single();
  if (!agent) throw new Error("Agent not found");
  await enforceRateLimit("agent_provisioning", agent.business_id);
  const template = Array.isArray(agent.agent_templates) ? agent.agent_templates[0] : agent.agent_templates;
  if (!template?.slug) throw new Error("Agent template is missing");
  await supabase.from("agents").update({ lifecycle_status: "ingesting", last_error: null }).eq("id", localAgentId);

  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/retell-create-agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getSupabaseServiceRoleKey()}` },
    body: JSON.stringify({
      business_id: agent.business_id,
      local_agent_id: agent.id,
      template_slug: template.slug,
      name: agent.name,
      voice_id: agent.voice_id,
      voice_provider: agent.voice_provider,
      include_calendar: true,
    }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    const message = payload.error ?? "Retell provisioning failed";
    await supabase.from("agents").update({ lifecycle_status: "failed", last_error: message.slice(0, 500) }).eq("id", localAgentId);
    throw new Error(message);
  }
  revalidatePath("/admin/agents");
}
