import fs from "node:fs";
for (const filename of [".env", ".env.local", "apps/web/.env.local"]) {
  if (!fs.existsSync(filename)) continue;
  for (const line of fs.readFileSync(filename, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}
const ids = process.argv.slice(2).filter((value) => value !== "--runs");
if (!process.env.RETELL_API_KEY || !ids.length) throw new Error("RETELL_API_KEY and batch IDs are required");
const results = await Promise.all(ids.map(async (id) => {
  const response = await fetch(`https://api.retellai.com/get-batch-test/${id}`, {
    headers: { Authorization: `Bearer ${process.env.RETELL_API_KEY}` },
  });
  if (!response.ok) throw new Error(`${id}: ${await response.text()}`);
  const result = await response.json();
  return { id, status: result.status, pass: result.pass_count, fail: result.fail_count, error: result.error_count, total: result.total_count };
}));
console.log(JSON.stringify(results, null, 2));
if (process.argv.includes("--runs")) {
  for (const id of ids) {
    const response = await fetch(`https://api.retellai.com/list-test-runs/${id}`, {
      headers: { Authorization: `Bearer ${process.env.RETELL_API_KEY}` },
    });
    const runs = await response.json();
    console.log(JSON.stringify((Array.isArray(runs) ? runs : []).map((run) => ({
      name: run.test_case_definition_snapshot?.name,
      status: run.status,
      explanation: run.result_explanation,
    })), null, 2));
  }
}
