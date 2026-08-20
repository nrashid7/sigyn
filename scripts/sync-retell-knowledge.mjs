#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

for (const filename of [".env", ".env.local", "apps/web/.env.local"]) {
  const file = path.resolve(filename);
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

const apply = process.argv.includes("--apply");
const businessArg = process.argv.find((value) => value.startsWith("--business="));
const businessFilter = businessArg?.slice("--business=".length);
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRole) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
}

async function supabase(pathname, init = {}) {
  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}${pathname}`, {
    ...init,
    headers: {
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${pathname} failed (${response.status})`);
  return body;
}

async function sync(operation) {
  return await supabase("/functions/v1/retell-knowledge-sync", {
    method: "POST",
    body: JSON.stringify(operation),
  });
}

const businessQuery = businessFilter
  ? `/rest/v1/businesses?id=eq.${encodeURIComponent(businessFilter)}&select=id,name`
  : "/rest/v1/businesses?select=id,name&order=created_at";
const businesses = await supabase(businessQuery);
const report = [];

for (const business of businesses) {
  const [documents, sources, agents, ownership] = await Promise.all([
    supabase(`/rest/v1/knowledge_documents?business_id=eq.${business.id}&select=id,retell_status`),
    supabase(`/rest/v1/business_sources?business_id=eq.${business.id}&type=eq.website&select=id,retell_status`),
    supabase(`/rest/v1/agents?business_id=eq.${business.id}&retell_llm_id=not.is.null&select=id,retell_llm_id`),
    supabase(`/rest/v1/business_knowledge_bases?business_id=eq.${business.id}&select=id,retell_knowledge_base_id,status`),
  ]);
  const pendingDocuments = documents.filter((item) => ["pending", "failed"].includes(item.retell_status));
  const pendingSources = sources.filter((item) => ["pending", "failed"].includes(item.retell_status));
  const summary = {
    business_id: business.id,
    documents_to_sync: pendingDocuments.length,
    urls_to_sync: pendingSources.length,
    agents_to_attach: agents.length,
    has_knowledge_base: Boolean(ownership[0]?.retell_knowledge_base_id),
  };

  if (!apply) {
    report.push({ ...summary, dry_run: true });
    continue;
  }

  for (const document of pendingDocuments) {
    await sync({ operation: "upload_document", document_id: document.id });
  }
  for (const source of pendingSources) {
    await sync({ operation: "add_url", source_id: source.id });
  }
  if (!pendingDocuments.length && !pendingSources.length && agents[0] && !ownership[0]?.retell_knowledge_base_id) {
    await sync({ operation: "ensure", agent_id: agents[0].id });
  }
  if (agents[0]) await sync({ operation: "attach_agents", agent_id: agents[0].id });
  const refreshedOwnership = await supabase(
    `/rest/v1/business_knowledge_bases?business_id=eq.${business.id}&select=id,retell_knowledge_base_id,status`,
  );
  if (refreshedOwnership[0]) {
    await sync({ operation: "reconcile", knowledge_base_record_id: refreshedOwnership[0].id });
  }
  report.push({ ...summary, dry_run: false, applied: true });
}

console.log(JSON.stringify({ mode: apply ? "apply" : "dry_run", businesses: report }, null, 2));
