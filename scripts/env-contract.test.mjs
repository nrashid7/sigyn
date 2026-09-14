#!/usr/bin/env node
// Guards against env-var drift: every env var the code reads must be
// documented in docs/ENVIRONMENT.md, every var listed in .env.example must be
// explained there too, and no naming from the previous (now-removed) voice
// provider should be left behind. This is the test that would have caught
// the Stripe-plan-mapping-to-"starter" bug sooner if it had existed for that
// class of drift.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", ".turbo", "dist", ".vercel"]);
const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".ttf", ".eot",
  ".pdf", ".zip", ".tsbuildinfo",
]);

/** Recursively lists files under `dir`, skipping build/dependency directories. */
function listAllFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listAllFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function listFiles(dir, extensions) {
  return listAllFiles(dir).filter((f) => extensions.some((ext) => f.endsWith(ext)));
}

function isTestFile(filePath) {
  const rel = relative(ROOT, filePath);
  const parts = rel.split(sep);
  return rel.endsWith(".test.mjs") || rel.endsWith("_test.ts") || parts.includes("tests");
}

function readText(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

// --- Collect every env var name the code actually reads ---------------------

const DENO_ENV_RE = /Deno\.env\.get\("([A-Z0-9_]+)"\)/g;
const PROCESS_ENV_RE = /process\.env\.([A-Z0-9_]+)/g;

function collectNames(files, regex) {
  const names = new Set();
  for (const file of files) {
    if (isTestFile(file)) continue;
    for (const match of readText(file).matchAll(regex)) {
      names.add(match[1]);
    }
  }
  return names;
}

const denoFiles = listFiles(join(ROOT, "supabase", "functions"), [".ts"]);
const webFiles = listFiles(join(ROOT, "apps", "web"), [".ts", ".tsx"]);
const sharedFiles = listFiles(join(ROOT, "packages", "shared", "src"), [".ts"]);
const scriptFiles = listFiles(join(ROOT, "scripts"), [".mjs"]);

const collected = new Set([
  ...collectNames(denoFiles, DENO_ENV_RE),
  ...collectNames(webFiles, PROCESS_ENV_RE),
  ...collectNames(sharedFiles, PROCESS_ENV_RE),
  ...collectNames(scriptFiles, PROCESS_ENV_RE),
]);

// Auto-injected by the Vercel/Supabase runtime, or CI — never hand-documented.
const RUNTIME_ALLOWLIST = new Set([
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
  "NODE_ENV",
  "VERCEL_URL",
  "CI",
]);

const environmentDoc = readText(join(ROOT, "docs", "ENVIRONMENT.md"));

test("every env var read by the code is documented in docs/ENVIRONMENT.md", () => {
  const missing = [...collected]
    .filter((name) => !RUNTIME_ALLOWLIST.has(name))
    .filter((name) => !environmentDoc.includes(name))
    .sort();
  assert.deepEqual(missing, [], `Undocumented env vars: ${missing.join(", ")}`);
});

// --- Every name in .env.example must be explained in docs/ENVIRONMENT.md ----

function namesInEnvExample(text) {
  const names = new Set();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Z0-9_]+)=/);
    if (match) names.add(match[1]);
  }
  return names;
}

test("every variable in .env.example is documented in docs/ENVIRONMENT.md", () => {
  const envExample = readText(join(ROOT, ".env.example"));
  const names = namesInEnvExample(envExample);
  const missing = [...names].filter((name) => !environmentDoc.includes(name)).sort();
  assert.deepEqual(
    missing,
    [],
    `.env.example vars missing from docs/ENVIRONMENT.md: ${missing.join(", ")}`,
  );
});

// --- No leftover naming from the voice provider this project replaced -------
//
// The banned word is assembled at runtime (never spelled out literally here)
// so that this guard — and a plain `grep -ri` over the repo — doesn't flag its
// own source for naming the thing it checks for.
const REMOVED_VOICE_PROVIDER = ["ret", "ell"].join("");

test("no file under supabase/functions, apps/web, packages/shared, scripts, docs, or n8n names the removed voice provider", () => {
  const roots = ["supabase/functions", "apps/web", "packages/shared", "scripts", "docs", "n8n"];
  const offenders = [];

  for (const root of roots) {
    for (const file of listAllFiles(join(ROOT, ...root.split("/")))) {
      if (BINARY_EXTENSIONS.has(file.slice(file.lastIndexOf(".")))) continue;

      const rel = relative(ROOT, file);
      if (rel.split(sep).slice(0, 2).join(sep) === join("supabase", "migrations")) continue;
      if (rel === join("docs", "BACKEND_PLAN.md")) continue;

      if (readText(file).toLowerCase().includes(REMOVED_VOICE_PROVIDER)) {
        offenders.push(rel);
      }
    }
  }

  assert.deepEqual(offenders, [], `Files still naming the removed voice provider: ${offenders.join(", ")}`);
});
