#!/usr/bin/env tsx
// ────────────────────────────────────────────────────────────────────────────
// EctoClaw Demo Script (Cross-Platform — macOS, Linux, Windows)
//
// Starts the dev server, opens the dashboard, then populates it with a
// realistic set of audit sessions and events so you can see everything live.
//
// Usage:
//   npx tsx scripts/demo.ts
//   npm run demo
//
// Environment variables:
//   PORT=3210          Override the server port   (default: 3210)
//   KEEP_DB=1          Keep the test database after exit (default: delete it)
// ────────────────────────────────────────────────────────────────────────────

import { spawn, exec, type ChildProcess } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// ── Configuration ───────────────────────────────────────────────────────────

const PORT = process.env.PORT ?? "3210";
const BASE = `http://localhost:${PORT}`;
const DB_PATH = join(tmpdir(), `ectoclaw-demo-${process.pid}.db`);
const KEEP_DB = process.env.KEEP_DB === "1";

let serverProcess: ChildProcess | null = null;
let ownsServer = false;

// ── Colours ─────────────────────────────────────────────────────────────────

const isTTY = process.stdout.isTTY ?? false;
const RED    = isTTY ? "\x1b[0;31m" : "";
const GREEN  = isTTY ? "\x1b[0;32m" : "";
const YELLOW = isTTY ? "\x1b[1;33m" : "";
const CYAN   = isTTY ? "\x1b[0;36m" : "";
const BOLD   = isTTY ? "\x1b[1m"    : "";
const RESET  = isTTY ? "\x1b[0m"    : "";

function log(msg: string)  { console.log(`${CYAN}[ectoclaw]${RESET} ${msg}`); }
function ok(msg: string)   { console.log(`${GREEN}  ✓${RESET} ${msg}`); }
function warn(msg: string) { console.log(`${YELLOW}  !${RESET} ${msg}`); }
function err(msg: string)  { console.log(`${RED}  ✗${RESET} ${msg}`); }
function sep()             { console.log(`${BOLD}────────────────────────────────────────────────────${RESET}`); }

// ── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function post(path: string, body: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  return res.json();
}

async function get(path: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`);
  return res.json();
}

async function waitForServer(retries = 30, interval = 300): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await sleep(interval);
  }
  err("Server did not start within 9 seconds");
  process.exit(1);
}

async function createSession(goal: string, policyName?: string): Promise<string> {
  const body: Record<string, string> = { goal };
  if (policyName) body.policy_name = policyName;
  const resp = await post("/api/sessions", JSON.stringify(body));
  return resp.id;
}

async function event(sessionId: string, payload: string): Promise<void> {
  await post(`/api/sessions/${sessionId}/events`, payload);
}

async function seal(sessionId: string): Promise<void> {
  await post(`/api/sessions/${sessionId}/seal`, "{}");
}

function openBrowser(url: string): void {
  const platform = process.platform;
  try {
    if (platform === "darwin") {
      exec(`open "${url}"`);
    } else if (platform === "win32") {
      exec(`start "" "${url}"`);
    } else if (platform === "linux") {
      exec(`xdg-open "${url}"`);
    } else {
      warn(`Could not detect a browser opener — visit manually: ${url}`);
    }
  } catch {
    warn(`Could not open browser — visit manually: ${url}`);
  }
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

function cleanup(): void {
  if (!ownsServer) return;

  log("Shutting down...");

  if (serverProcess && !serverProcess.killed) {
    // On Windows, spawn with shell requires tree-kill style termination.
    // process.kill with SIGTERM works on Unix; on Windows .kill() sends SIGTERM equivalent.
    try {
      if (process.platform === "win32") {
        // On Windows, we need to kill the process tree
        exec(`taskkill /pid ${serverProcess.pid} /T /F`, () => {});
      } else {
        serverProcess.kill("SIGTERM");
      }
      ok(`Server stopped (PID ${serverProcess.pid})`);
    } catch {
      // process may have already exited
    }
  }

  if (!KEEP_DB && existsSync(DB_PATH)) {
    try {
      unlinkSync(DB_PATH);
      ok("Cleaned up demo database");
    } catch {
      warn(`Could not delete demo database: ${DB_PATH}`);
    }
  } else if (KEEP_DB) {
    warn(`Database kept at: ${DB_PATH}`);
  }
}

// Register cleanup on exit signals
process.on("exit", cleanup);
process.on("SIGINT", () => { process.exit(0); });
process.on("SIGTERM", () => { process.exit(0); });

// On Windows, handle Ctrl+C via SIGBREAK as well
if (process.platform === "win32") {
  process.on("SIGBREAK", () => { process.exit(0); });
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  sep();
  console.log(`${BOLD}🦞  EctoClaw Demo${RESET}`);
  sep();

  // ── Step 1: Start server ──────────────────────────────────────────────────

  let serverAlreadyRunning = false;
  try {
    const res = await fetch(`${BASE}/health`);
    if (res.ok) serverAlreadyRunning = true;
  } catch {
    // not running
  }

  if (serverAlreadyRunning) {
    warn(`Server already running on port ${PORT} — reusing it`);
    ownsServer = false;
  } else {
    log(`Starting EctoClaw dev server on port ${PORT}...`);

    const projectRoot = resolve(import.meta.dirname ?? ".", "..");
    const distCli = join(projectRoot, "dist", "cli", "index.js");
    const srcCli = join(projectRoot, "src", "cli", "index.ts");

    // Prefer built dist; fall back to tsx for dev
    if (existsSync(distCli)) {
      serverProcess = spawn(
        process.execPath, // node
        [distCli, "serve", "--dev", "--port", PORT, "--db", DB_PATH],
        { stdio: "ignore", detached: process.platform !== "win32" }
      );
    } else {
      // Use npx tsx to run TypeScript source directly
      const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
      serverProcess = spawn(
        npxCmd,
        ["tsx", srcCli, "serve", "--dev", "--port", PORT, "--db", DB_PATH],
        { stdio: "ignore", detached: process.platform !== "win32" }
      );
    }

    ownsServer = true;
    serverProcess.unref();

    await waitForServer();
    ok(`Server ready at ${BASE}`);
  }

  // ── Step 2: Open dashboard ────────────────────────────────────────────────
  log("Opening dashboard...");
  openBrowser(`${BASE}/dashboard/`);
  await sleep(1000);

  // ── Step 3: Populate data ─────────────────────────────────────────────────
  sep();
  log("Populating demo data...");
  sep();

  // ── Session 1: WhatsApp bot ───────────────────────────────────────────────
  log("Creating session 1 — WhatsApp customer support bot");
  const s1 = await createSession("WhatsApp customer support — order inquiry");

  await event(s1, '{"type":"MessageReceived","channel":"whatsapp","sender":"user:customer_42","content":"Hi, where is my order #98765?"}');
  await sleep(200);
  await event(s1, '{"type":"SkillInvoked","skill":"order-lookup","parameters":{"order_id":"98765"}}');
  await sleep(200);
  await event(s1, '{"type":"ToolCall","tool":"db_query","arguments":{"table":"orders","order_id":"98765"}}');
  await sleep(200);
  await event(s1, '{"type":"ToolResult","tool":"db_query","result":{"status":"shipped","eta":"2026-02-28"},"success":true}');
  await sleep(200);
  await event(s1, '{"type":"ModelRequest","model":"gpt-4o","prompt":"Summarise the order status for the customer"}');
  await sleep(200);
  await event(s1, '{"type":"ModelResponse","model":"gpt-4o","response":"Your order #98765 has shipped and arrives tomorrow, Feb 28.","tokens_used":42}');
  await sleep(200);
  await event(s1, '{"type":"MessageSent","channel":"whatsapp","recipient":"user:customer_42","content":"Your order #98765 has shipped! Estimated arrival: Feb 28."}');
  await seal(s1);
  ok("Session 1 sealed — 7 events");

  // ── Session 2: Telegram news bot ──────────────────────────────────────────
  log("Creating session 2 — Telegram news summary bot");
  const s2 = await createSession("Telegram daily news digest — 2026-02-27");

  await event(s2, '{"type":"SkillInvoked","skill":"web-search","parameters":{"query":"top news today 2026-02-27","limit":5}}');
  await sleep(200);
  await event(s2, '{"type":"ToolCall","tool":"http_get","arguments":{"url":"https://newsapi.example.com/top?date=2026-02-27"}}');
  await sleep(200);
  await event(s2, '{"type":"ToolResult","tool":"http_get","result":{"articles":["AI breakthrough","Market rally","Climate accord"]},"success":true}');
  await sleep(200);
  await event(s2, '{"type":"AgentThought","thought":"I have 3 articles — summarising for digest"}');
  await sleep(200);
  await event(s2, '{"type":"ModelRequest","model":"claude-3-5-sonnet","prompt":"Summarise these headlines into a 3-sentence digest"}');
  await sleep(200);
  await event(s2, '{"type":"ModelResponse","model":"claude-3-5-sonnet","response":"AI saw a major breakthrough today. Markets rallied 2.3%. A new climate accord was signed by 50 nations.","tokens_used":78}');
  await sleep(200);
  await event(s2, '{"type":"MessageSent","channel":"telegram","recipient":"channel:daily_news","content":"📰 Daily Digest: AI breakthrough, markets +2.3%, climate accord signed."}');
  await seal(s2);
  ok("Session 2 sealed — 7 events");

  // ── Session 3: Still active — real-time streaming ─────────────────────────
  log("Creating session 3 — Discord moderation bot (stays active)");
  const s3 = await createSession("Discord moderation — #general channel monitoring");

  await event(s3, '{"type":"MessageReceived","channel":"discord","sender":"user:anon_user","content":"Check out this great deal at spamsite.example.com"}');
  await sleep(300);
  await event(s3, '{"type":"SkillInvoked","skill":"url-scanner","parameters":{"url":"spamsite.example.com"}}');
  await sleep(300);
  await event(s3, '{"type":"ToolCall","tool":"safebrowsing_check","arguments":{"url":"spamsite.example.com"}}');
  await sleep(300);
  await event(s3, '{"type":"ToolResult","tool":"safebrowsing_check","result":{"flagged":true,"category":"spam"},"success":true}');
  await sleep(300);
  await event(s3, '{"type":"PluginAction","plugin_name":"discord-mod","action":"delete_message","target":"msg:99887766"}');
  await sleep(300);
  await event(s3, '{"type":"MessageSent","channel":"discord","recipient":"user:anon_user","content":"Your message was removed for containing a flagged link."}');
  ok("Session 3 active — 6 events (not sealed — stays live)");

  // ── Session 4: Memory + multi-step reasoning ─────────────────────────────
  log("Creating session 4 — Slack scheduling assistant");
  const s4 = await createSession("Slack assistant — team meeting scheduler");

  await event(s4, '{"type":"MessageReceived","channel":"slack","sender":"user:alice","content":"Can you schedule a team standup for tomorrow at 9am?"}');
  await sleep(200);
  await event(s4, '{"type":"MemoryRead","key":"user:alice:preferences","value":"{\\"timezone\\":\\"America/New_York\\",\\"calendar\\":\\"google\\"}"}');
  await sleep(200);
  await event(s4, '{"type":"ToolCall","tool":"calendar_create","arguments":{"title":"Team Standup","time":"2026-02-28T09:00:00-05:00","attendees":["alice","bob","carol"]}}');
  await sleep(200);
  await event(s4, '{"type":"ToolResult","tool":"calendar_create","result":{"event_id":"evt_abc123","link":"https://cal.example.com/evt_abc123"},"success":true}');
  await sleep(200);
  await event(s4, '{"type":"MemoryWrite","key":"last_scheduled_event","value":"evt_abc123"}');
  await sleep(200);
  await event(s4, '{"type":"MessageSent","channel":"slack","recipient":"user:alice","content":"Done! Standup scheduled for tomorrow at 9am ET. Calendar invite sent to Alice, Bob, and Carol."}');
  await seal(s4);
  ok("Session 4 sealed — 6 events");

  // ── Done ──────────────────────────────────────────────────────────────────
  sep();
  console.log(`${GREEN}${BOLD}Demo data loaded!${RESET}`);
  sep();
  console.log();
  console.log(`  Dashboard:  ${CYAN}${BASE}/dashboard/${RESET}`);
  console.log(`  API:        ${CYAN}${BASE}/api/${RESET}`);
  console.log(`  Sessions:   ${CYAN}${BASE}/api/sessions${RESET}`);
  console.log(`  Metrics:    ${CYAN}${BASE}/api/metrics${RESET}`);
  console.log();
  console.log("  Sessions created:");
  console.log(`    S1 (sealed):  ${CYAN}${s1}${RESET}  — WhatsApp order inquiry`);
  console.log(`    S2 (sealed):  ${CYAN}${s2}${RESET}  — Telegram news digest`);
  console.log(`    S3 (active):  ${CYAN}${s3}${RESET}  — Discord moderation`);
  console.log(`    S4 (sealed):  ${CYAN}${s4}${RESET}  — Slack scheduler`);
  console.log();

  // ── Verify chains ────────────────────────────────────────────────────────
  log("Verifying all chains...");
  for (const [label, sid] of [["S1", s1], ["S2", s2], ["S3", s3], ["S4", s4]]) {
    try {
      const result = await get(`/api/sessions/${sid}/verify`);
      if (result.verified === true || result.verified === "true" || result.verified === "True") {
        ok(`Chain verified: ${sid.substring(0, 8)}...`);
      } else {
        err(`Chain BROKEN: ${sid.substring(0, 8)}... — ${JSON.stringify(result)}`);
      }
    } catch (e) {
      err(`Chain verify failed for ${label}: ${e}`);
    }
  }

  console.log();

  if (ownsServer) {
    warn("Server is running. Press Ctrl+C to stop.");
    console.log();
    // Keep the process alive until the user interrupts
    await new Promise<void>(() => {
      // intentionally never resolves — cleanup runs on SIGINT/SIGTERM
    });
  } else {
    ok("Done.");
  }
}

main().catch((e) => {
  err(`Demo failed: ${e}`);
  process.exit(1);
});
