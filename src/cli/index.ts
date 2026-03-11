#!/usr/bin/env node
/**
 * EctoClaw CLI — command-line interface for the EctoClaw audit ledger.
 * 
 * Commands:
 *   serve     Start the EctoClaw server
 *   verify    Verify a session's hash chain
 *   report    Generate an audit report
 *   sessions  List sessions
 *   status    Show server status
 */

import { Command } from "commander";
import { startServer } from "../server/index.js";
import { SqliteLedger } from "../ledger/sqlite.js";
import { buildMerkleTree } from "../core/merkle.js";

const program = new Command();

program
  .name("ectoclaw")
  .description("🦞 EctoClaw — Cryptographic audit ledger for OpenClaw AI agents")
  .version("0.1.0");

// ── serve ──────────────────────────────────────────────────────────────

program
  .command("serve")
  .description("Start the EctoClaw audit ledger server")
  .option("-p, --port <number>", "Port to listen on", "3210")
  .option("-H, --host <address>", "Host to bind to", "0.0.0.0")
  .option("-d, --db <path>", "SQLite database path", "./data/ectoclaw.db")
  .option("--dev", "Enable development mode (no auth required)")
  .option("--admin-token <token>", "Admin bearer token")
  .action(async (opts) => {
    await startServer({
      port: parseInt(opts.port, 10),
      host: opts.host,
      dbPath: opts.db,
      devMode: opts.dev ?? process.env.ECTOCLAW_DEV_MODE === "true",
      adminToken: opts.adminToken ?? process.env.ECTOCLAW_ADMIN_TOKEN,
    });
  });

// ── verify ─────────────────────────────────────────────────────────────

program
  .command("verify")
  .description("Verify a session's hash chain integrity")
  .argument("<session-id>", "Session ID to verify")
  .option("-d, --db <path>", "SQLite database path", "./data/ectoclaw.db")
  .action(async (sessionId, opts) => {
    const ledger = new SqliteLedger(opts.db);
    await ledger.initialize();

    try {
      const session = await ledger.getSession(sessionId);
      if (!session) {
        console.error(`❌ Session not found: ${sessionId}`);
        process.exit(1);
      }

      console.log(`\n🦞 Verifying session: ${sessionId}`);
      console.log(`   Goal: ${session.goal}`);
      console.log(`   Status: ${session.status}`);
      console.log(`   Events: ${session.event_count}`);

      const result = await ledger.verifyChain(sessionId);

      if (result.verified) {
        console.log(`\n   ✅ Hash chain VERIFIED (${result.events_checked} events)`);

        // Also show Merkle root
        const events = await ledger.getEvents(sessionId);
        if (events.length > 0) {
          const hashes = events.map((e) => e.content_hash);
          const tree = buildMerkleTree(hashes);
          console.log(`   🌳 Merkle root: ${tree.root}`);
        }
      } else {
        console.log(`\n   ❌ Hash chain BROKEN at sequence ${result.broken_at_sequence}`);
        process.exit(1);
      }
    } finally {
      await ledger.close();
    }
  });

// ── report ─────────────────────────────────────────────────────────────

program
  .command("report")
  .description("Generate an audit report for a session")
  .argument("<session-id>", "Session ID to report on")
  .option("-d, --db <path>", "SQLite database path", "./data/ectoclaw.db")
  .option("-f, --format <format>", "Output format: json or html", "json")
  .option("-o, --output <file>", "Output file path (defaults to stdout)")
  .action(async (sessionId, opts) => {
    const ledger = new SqliteLedger(opts.db);
    await ledger.initialize();

    try {
      const session = await ledger.getSession(sessionId);
      if (!session) {
        console.error(`❌ Session not found: ${sessionId}`);
        process.exit(1);
      }

      const events = await ledger.getEvents(sessionId);
      const verification = await ledger.verifyChain(sessionId);
      const compliance = await ledger.getComplianceBundle(sessionId);

      const report = {
        session,
        events,
        verification,
        compliance,
        generated_at: new Date().toISOString(),
      };

      let output: string;
      if (opts.format === "html") {
        const rows = events
          .map(
            (e) =>
              `<tr><td>${e.sequence}</td><td>${e.payload.type}</td><td><code>${e.content_hash.slice(0, 16)}…</code></td><td>${e.created_at}</td></tr>`,
          )
          .join("\n");
        output = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>EctoClaw Audit Report — ${session.id}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
    h1 { color: #2563eb; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
    th, td { padding: 0.5rem; text-align: left; border-bottom: 1px solid #e5e7eb; }
    th { background: #f3f4f6; }
    .badge { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.85rem; font-weight: 600; }
    .badge-ok { background: #dcfce7; color: #166534; }
    .badge-fail { background: #fee2e2; color: #991b1b; }
    code { background: #f3f4f6; padding: 0.1rem 0.3rem; border-radius: 3px; font-size: 0.85rem; }
  </style>
</head>
<body>
  <h1>🦞 EctoClaw Audit Report</h1>
  <h2>Session ${session.id}</h2>
  <p><strong>Goal:</strong> ${session.goal}</p>
  <p><strong>Status:</strong> ${session.status}</p>
  <p><strong>Chain integrity:</strong>
    <span class="badge ${verification.verified ? 'badge-ok' : 'badge-fail'}">
      ${verification.verified ? '✓ Verified' : '✗ Broken'}
    </span>
    (${verification.events_checked} events)
  </p>
  <p><strong>Merkle root:</strong> <code>${compliance.merkle_root || 'N/A'}</code></p>
  <h3>Event Log</h3>
  <table>
    <thead><tr><th>#</th><th>Type</th><th>Hash</th><th>Time</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p style="margin-top: 2rem; color: #6b7280; font-size: 0.85rem;">
    Generated by EctoClaw v0.1.0 at ${report.generated_at}
  </p>
</body>
</html>`;
      } else {
        output = JSON.stringify(report, null, 2);
      }

      if (opts.output) {
        const { writeFileSync } = await import("node:fs");
        writeFileSync(opts.output, output);
        console.log(`📄 Report written to ${opts.output}`);
      } else {
        console.log(output);
      }
    } finally {
      await ledger.close();
    }
  });

// ── sessions ───────────────────────────────────────────────────────────

program
  .command("sessions")
  .description("List audit sessions")
  .option("-d, --db <path>", "SQLite database path", "./data/ectoclaw.db")
  .option("-l, --limit <number>", "Maximum sessions to show", "20")
  .action(async (opts) => {
    const ledger = new SqliteLedger(opts.db);
    await ledger.initialize();

    try {
      const sessions = await ledger.listSessions(parseInt(opts.limit, 10));
      
      if (sessions.length === 0) {
        console.log("No sessions found.");
        return;
      }

      console.log("\n🦞 EctoClaw Sessions\n");
      console.log("ID                                   | Status  | Events | Goal");
      console.log("─".repeat(80));

      for (const s of sessions) {
        const status = s.status.padEnd(7);
        const events = String(s.event_count).padStart(6);
        const goal = s.goal.length > 30 ? s.goal.slice(0, 27) + "..." : s.goal;
        console.log(`${s.id} | ${status} | ${events} | ${goal}`);
      }

      console.log(`\nTotal: ${sessions.length} sessions`);
    } finally {
      await ledger.close();
    }
  });

// ── status ─────────────────────────────────────────────────────────────

program
  .command("status")
  .description("Show ledger status and metrics")
  .option("-d, --db <path>", "SQLite database path", "./data/ectoclaw.db")
  .action(async (opts) => {
    const ledger = new SqliteLedger(opts.db);
    await ledger.initialize();

    try {
      const metrics = await ledger.getMetrics();

      console.log("\n🦞 EctoClaw Ledger Status\n");
      console.log(`   Total sessions:  ${metrics.total_sessions}`);
      console.log(`   Active sessions: ${metrics.active_sessions}`);
      console.log(`   Sealed sessions: ${metrics.sealed_sessions}`);
      console.log(`   Total events:    ${metrics.total_events}`);
      
      if (Object.keys(metrics.events_by_type).length > 0) {
        console.log("\n   Events by type:");
        for (const [type, count] of Object.entries(metrics.events_by_type)) {
          console.log(`     ${type}: ${count}`);
        }
      }
    } finally {
      await ledger.close();
    }
  });

program.parse();
