#!/usr/bin/env node
const args = process.argv.slice(2);
const value = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const environment = value("environment");
if (!['staging', 'production'].includes(environment)) throw new Error("Pass --environment=staging or --environment=production");
if (environment === "production" && !args.includes("--confirm-production")) {
  throw new Error("Production control changes require --confirm-production");
}

const definitions = {
  signup: "signup_enabled",
  "agent-provisioning": "agent_provisioning_enabled",
  billing: "billing_enabled",
  "automation-dispatch": "automation_dispatch_enabled",
};
const updates = {};
for (const [argumentName, column] of Object.entries(definitions)) {
  const setting = value(argumentName);
  if (setting === undefined) continue;
  if (!['on', 'off'].includes(setting)) throw new Error(`--${argumentName} must be on or off`);
  updates[column] = setting === 'on';
}
if (!Object.keys(updates).length) throw new Error("Pass at least one control setting");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase credentials are required");
const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/system_controls?id=eq.true`, {
  method: "PATCH",
  headers: {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  },
  body: JSON.stringify({ ...updates, updated_at: new Date().toISOString() }),
});
if (!response.ok) throw new Error(`Could not update production controls (${response.status})`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length !== 1) throw new Error("Production control row was not updated");
console.log(JSON.stringify({ environment, controls: updates, updated_at: rows[0].updated_at }, null, 2));
