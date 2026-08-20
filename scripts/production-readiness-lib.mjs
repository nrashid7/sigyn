export const REQUIRED_LIVE_CHECKS = [
  "inbound_call",
  "sms",
  "hubspot",
  "gohighlevel",
  "google_sheets",
  "calendar",
  "stripe_live",
];

export function validateProductionEvidence(evidence, expectedRelease, now = Date.now()) {
  const failures = [];
  if (!evidence || typeof evidence !== "object") return ["Production evidence is missing"];
  if (evidence.environment !== "production") failures.push("Evidence environment must be production");
  if (!expectedRelease || evidence.release !== expectedRelease) failures.push("Evidence release does not match the deployed release");
  const verifiedAt = Date.parse(evidence.verified_at);
  if (!Number.isFinite(verifiedAt) || verifiedAt > now || now - verifiedAt > 24 * 60 * 60 * 1000) {
    failures.push("Evidence must have been recorded within the last 24 hours");
  }
  for (const name of REQUIRED_LIVE_CHECKS) {
    const check = evidence.checks?.[name];
    if (check?.passed !== true || typeof check.evidence_id !== "string" || !check.evidence_id.trim()) {
      failures.push(`Missing passing evidence for ${name}`);
    }
  }
  return failures;
}
