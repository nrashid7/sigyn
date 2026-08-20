#!/usr/bin/env node
import { createHmac, randomBytes } from "node:crypto";

function argument(name) {
  const exact = process.argv.indexOf(`--${name}`);
  if (exact >= 0) return process.argv[exact + 1];
  return process.argv.slice(2).find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const email = String(argument("email") ?? "").trim().toLowerCase();
const expiresHours = Number(argument("expires-hours") ?? 168);
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const invitationSecret = process.env.BETA_INVITE_SECRET;

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Pass a valid --email address");
if (!Number.isFinite(expiresHours) || expiresHours < 1 || expiresHours > 720) throw new Error("--expires-hours must be between 1 and 720");
if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase production credentials are required");
if (!invitationSecret || invitationSecret.length < 16) throw new Error("BETA_INVITE_SECRET must contain at least 16 characters");

const code = randomBytes(24).toString("base64url");
const codeHash = createHmac("sha256", invitationSecret).update(code).digest("hex");
const expiresAt = new Date(Date.now() + expiresHours * 60 * 60 * 1000).toISOString();
const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/beta_invitations`, {
  method: "POST",
  headers: {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  },
  body: JSON.stringify({ email, code_hash: codeHash, expires_at: expiresAt }),
});
if (!response.ok) throw new Error(`Could not create beta invitation (${response.status})`);

console.log(JSON.stringify({ email, invite_code: code, expires_at: expiresAt }, null, 2));
console.error("Store and transmit this single-use invitation securely; the plaintext code is not retained.");
