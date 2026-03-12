/**
 * REST API routes for EctoClaw.
 * 
 * Mirrors EctoLedger's API surface, adapted for OpenClaw audit events.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { computeContentHash, sha256Hex, GENESIS_PREVIOUS_HASH } from "../core/hash.js";
import { generateKeyPair, signContentHash } from "../core/signing.js";
import { buildMerkleTree, generateProof, verifyProof } from "../core/merkle.js";
import { PolicyEngine, parsePolicy } from "../core/policy.js";
import type { EventPayload } from "../core/schema.js";
import type { SqliteLedger } from "../ledger/sqlite.js";
import type { SSEBroadcaster } from "./sse.js";
import { requireRole, type Role } from "./auth.js";

// Store session private keys in memory (per-process)
const sessionKeys = new Map<string, string>();

function extractTextValues(value: unknown, key?: string): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractTextValues(item));
  }
  if (!value || typeof value !== "object") return [];

  return Object.entries(value as Record<string, unknown>).flatMap(([entryKey, entryValue]) => {
    if (entryKey === "type" || key === "type") return [];
    return extractTextValues(entryValue, entryKey);
  });
}

function extractPayloadText(payload: EventPayload): string {
  return extractTextValues(payload).join(" ").trim();
}

function redactPayloadValue(value: unknown, pattern: RegExp, replacement: string, key?: string): unknown {
  if (typeof value === "string") {
    if (key === "type") return value;
    return value.replace(pattern, replacement);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactPayloadValue(item, pattern, replacement));
  }
  if (!value || typeof value !== "object") return value;

  const obj = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(obj)) {
    result[entryKey] = redactPayloadValue(entryValue, pattern, replacement, entryKey);
  }
  return result;
}

function redactPayload(payload: EventPayload, pattern: string, label: string): EventPayload {
  const regex = new RegExp(pattern, "gi");
  const replacement = `[REDACTED:${label}]`;
  return redactPayloadValue(payload, regex, replacement) as EventPayload;
}

export function createRoutes(ledger: SqliteLedger, sse: SSEBroadcaster, dataDir: string): Router {
  const router = Router();

  // Ensure per-session key directory exists inside the data folder
  const sessionKeysDir = join(dataDir, "sessions");
  mkdirSync(sessionKeysDir, { recursive: true });

  /** Look up a session private key: in-memory first, then disk (survives restarts). */
  function getSessionKey(sessionId: string): string | undefined {
    if (sessionKeys.has(sessionId)) return sessionKeys.get(sessionId);
    const keyFile = join(sessionKeysDir, `${sessionId}.json`);
    if (existsSync(keyFile)) {
      try {
        const { privateKey } = JSON.parse(readFileSync(keyFile, "utf-8")) as { privateKey: string };
        sessionKeys.set(sessionId, privateKey); // warm the in-memory cache
        return privateKey;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  /** Remove a session private key from memory and disk. */
  function deleteSessionKey(sessionId: string): void {
    sessionKeys.delete(sessionId);
    const keyFile = join(sessionKeysDir, `${sessionId}.json`);
    if (existsSync(keyFile)) {
      try { unlinkSync(keyFile); } catch { /* ignore */ }
    }
  }

  // ── Sessions ──────────────────────────────────────────────────────────

  router.get("/api/sessions", async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 100);
      const offset = Number(req.query.offset) || 0;
      const sessions = await ledger.listSessions(limit, offset);
      res.json(sessions);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.get("/api/sessions/:id", async (req, res) => {
    try {
      const session = await ledger.getSession(req.params.id);
      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      res.json(session);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post("/api/sessions", async (req, res) => {
    try {
      const { goal, policy_name } = req.body as { goal?: string; policy_name?: string };
      if (!goal) {
        res.status(400).json({ error: "Missing 'goal' field" });
        return;
      }

      const keyPair = await generateKeyPair();
      let policyHash: string | undefined;

      if (policy_name) {
        const policy = ledger.getPolicy(policy_name);
        if (policy) {
          policyHash = policy.hash;
        }
      }

      const session = await ledger.createSession({
        goal,
        policyName: policy_name,
        policyHash,
        publicKey: keyPair.publicKey,
      });

      // Persist the private key to memory and to data/sessions/ for durability across restarts
      sessionKeys.set(session.id, keyPair.privateKey);
      writeFileSync(
        join(sessionKeysDir, `${session.id}.json`),
        JSON.stringify({ session_id: session.id, privateKey: keyPair.privateKey }),
        "utf-8",
      );

      // Append genesis event
      const genesisPayload: EventPayload = { type: "Genesis", message: `Session created: ${goal}` };
      const payloadJson = JSON.stringify(genesisPayload);
      const contentHash = computeContentHash(GENESIS_PREVIOUS_HASH, 0, payloadJson);
      const signature = await signContentHash(keyPair.privateKey, contentHash);

      await ledger.appendEvent(
        session.id,
        genesisPayload,
        contentHash,
        GENESIS_PREVIOUS_HASH,
        0,
        keyPair.publicKey,
        signature,
      );

      sse.broadcast({ type: "session_created", data: { session_id: session.id, goal } });

      res.status(201).json(session);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post("/api/sessions/:id/seal", async (req, res) => {
    try {
      const session = await ledger.getSession(req.params.id);
      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      if (session.status === "sealed") {
        res.status(409).json({ error: "Session already sealed" });
        return;
      }

      const latest = await ledger.getLatest(session.id);
      const finalHash = latest?.contentHash ?? GENESIS_PREVIOUS_HASH;

      // Append seal event
      const privateKey = getSessionKey(session.id);
      if (privateKey) {
        const sealPayload: EventPayload = {
          type: "SessionSeal",
          final_hash: finalHash,
          event_count: session.event_count + 1,
        };
        const prevHash = latest?.contentHash ?? GENESIS_PREVIOUS_HASH;
        const sequence = (latest?.sequence ?? -1) + 1;
        const payloadJson = JSON.stringify(sealPayload);
        const contentHash = computeContentHash(prevHash, sequence, payloadJson);
        const signature = await signContentHash(privateKey, contentHash);

        await ledger.appendEvent(
          session.id, sealPayload, contentHash, prevHash, sequence,
          session.public_key, signature,
        );

        await ledger.sealSession(session.id, contentHash);
      } else {
        await ledger.sealSession(session.id, finalHash);
      }

      deleteSessionKey(session.id);
      sse.broadcast({ type: "session_sealed", data: { session_id: session.id } });
      res.json({ status: "sealed", session_id: session.id });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Events ──────────────────────────────────────────────────────────────

  router.get("/api/events", async (req, res) => {
    try {
      const sessionId = req.query.session_id as string;
      if (!sessionId) {
        res.status(400).json({ error: "Missing 'session_id' query parameter" });
        return;
      }
      const events = await ledger.getEvents(sessionId);
      res.json(events);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post("/api/sessions/:id/events", async (req, res) => {
    try {
      const session = await ledger.getSession(req.params.id);
      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      if (session.status === "sealed") {
        res.status(409).json({ error: "Cannot append to sealed session" });
        return;
      }

      let payload = req.body as EventPayload;
      if (!payload || !payload.type) {
        res.status(400).json({ error: "Missing event payload with 'type' field" });
        return;
      }

      // Get previous hash and sequence
      const latest = await ledger.getLatest(session.id);
      const prevHash = latest?.contentHash ?? GENESIS_PREVIOUS_HASH;
      const sequence = (latest?.sequence ?? -1) + 1;

      let policyFlagDetails: string[] = [];

      // Apply policy if configured
      if (session.policy_name) {
        const policyData = ledger.getPolicy(session.policy_name);
        if (policyData) {
          try {
            const policyObj = parsePolicy(policyData.content);
            const engine = new PolicyEngine(policyObj);
            const decision = engine.evaluate(payload, sequence);

            if (decision.action === "deny") {
              // Record the violation
              const violationPayload: EventPayload = {
                type: "PolicyViolation",
                rule: session.policy_name,
                action: payload.type,
                details: decision.reason,
              };
              const vjson = JSON.stringify(violationPayload);
              const vhash = computeContentHash(prevHash, sequence, vjson);
              const privateKey = getSessionKey(session.id);
              const vsig = privateKey ? await signContentHash(privateKey, vhash) : "";

              await ledger.appendEvent(
                session.id, violationPayload, vhash, prevHash, sequence,
                session.public_key, vsig,
              );

              sse.broadcast({ type: "policy_violation", data: { session_id: session.id, reason: decision.reason } });
              res.status(403).json({ error: "Policy violation", reason: decision.reason });
              return;
            }

            const payloadText = extractPayloadText(payload);
            if (payloadText.length > 0) {
              const filterResult = engine.applyAllMessageFilters(payloadText);

              if (filterResult.blocked) {
                const blockedLabel = filterResult.blocked.label;
                const violationPayload: EventPayload = {
                  type: "PolicyViolation",
                  rule: session.policy_name,
                  action: "block",
                  details: `Content blocked by filter: ${blockedLabel}`,
                };
                const vjson = JSON.stringify(violationPayload);
                const vhash = computeContentHash(prevHash, sequence, vjson);
                const privateKey = getSessionKey(session.id);
                const vsig = privateKey ? await signContentHash(privateKey, vhash) : "";

                await ledger.appendEvent(
                  session.id,
                  violationPayload,
                  vhash,
                  prevHash,
                  sequence,
                  session.public_key,
                  vsig,
                );

                sse.broadcast({
                  type: "policy_violation",
                  data: { session_id: session.id, reason: violationPayload.details },
                });
                res.status(403).json({
                  blocked: true,
                  label: blockedLabel,
                  policy: session.policy_name,
                });
                return;
              }

              if (filterResult.redactions.length > 0) {
                for (const redaction of filterResult.redactions) {
                  payload = redactPayload(payload, redaction.pattern, redaction.label);
                }
              }

              if (filterResult.flags.length > 0) {
                policyFlagDetails = filterResult.flags.map((flag) => flag.details);
              }
            }
          } catch (policyErr) {
            console.warn(`Policy parse error for "${session.policy_name}":`, policyErr);
          }
        }
      }

      const payloadJson = JSON.stringify(payload);
      const contentHash = computeContentHash(prevHash, sequence, payloadJson);
      const privateKey = getSessionKey(session.id);
      const signature = privateKey ? await signContentHash(privateKey, contentHash) : "";

      const result = await ledger.appendEvent(
        session.id, payload, contentHash, prevHash, sequence,
        session.public_key, signature,
      );

      if (session.policy_name && policyFlagDetails.length > 0) {
        let flagPrevHash = contentHash;
        let flagSequence = sequence + 1;
        for (const details of policyFlagDetails) {
          const violationPayload: EventPayload = {
            type: "PolicyViolation",
            rule: session.policy_name,
            action: "flag",
            details,
          };
          const vjson = JSON.stringify(violationPayload);
          const vhash = computeContentHash(flagPrevHash, flagSequence, vjson);
          const privateKey = getSessionKey(session.id);
          const vsig = privateKey ? await signContentHash(privateKey, vhash) : "";

          await ledger.appendEvent(
            session.id, violationPayload, vhash, flagPrevHash, flagSequence,
            session.public_key, vsig,
          );

          sse.broadcast({ type: "policy_violation", data: { session_id: session.id, reason: details } });
          flagPrevHash = vhash;
          flagSequence += 1;
        }
      }

      sse.broadcast({ type: "event_appended", data: { session_id: session.id, sequence, event_type: payload.type } });
      res.status(201).json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Verification ────────────────────────────────────────────────────────

  router.get("/api/sessions/:id/verify", async (req, res) => {
    try {
      const result = await ledger.verifyChain(req.params.id);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Compliance ──────────────────────────────────────────────────────────

  router.get("/api/sessions/:id/compliance", async (req, res) => {
    try {
      const bundle = await ledger.getComplianceBundle(req.params.id);
      res.json(bundle);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Merkle Proofs ─────────────────────────────────────────────────────

  router.get("/api/sessions/:id/merkle", async (req, res) => {
    try {
      const events = await ledger.getEvents(req.params.id);
      if (events.length === 0) {
        res.status(404).json({ error: "No events found" });
        return;
      }

      const hashes = events.map((e) => e.content_hash);
      const tree = buildMerkleTree(hashes);

      const leafIndex = req.query.leaf !== undefined ? Number(req.query.leaf) : undefined;
      if (leafIndex !== undefined) {
        const proof = generateProof(tree, leafIndex);
        res.json({ root: tree.root, proof });
      } else {
        res.json({ root: tree.root, leaf_count: tree.leafCount });
      }
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post("/api/merkle/verify", async (req, res) => {
    try {
      const { root, leaf_hash, proof } = req.body;
      const valid = verifyProof(root, leaf_hash, proof);
      res.json({ valid });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Metrics ─────────────────────────────────────────────────────────────

  router.get("/api/metrics", async (_req, res) => {
    try {
      const metrics = await ledger.getMetrics();
      res.json(metrics);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Policies ──────────────────────────────────────────────────────────

  router.get("/api/policies", (_req, res) => {
    try {
      const policies = ledger.listPolicies();
      res.json(policies);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.get("/api/policies/:name", (req, res) => {
    try {
      const policy = ledger.getPolicy(req.params.name);
      if (!policy) {
        res.status(404).json({ error: "Policy not found" });
        return;
      }
      res.type("text/plain").send(policy.content);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.put("/api/policies/:name", requireRole("admin"), (req, res) => {
    try {
      let content: string;
      if (typeof req.body === "string") {
        content = req.body;
      } else if (req.body && typeof req.body.content === "string") {
        content = req.body.content;
      } else {
        res.status(400).json({ error: "Missing policy content" });
        return;
      }
      const policyName = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
      ledger.savePolicy(policyName, content);
      res.json({ status: "saved", name: policyName });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.delete("/api/policies/:name", requireRole("admin"), (req, res) => {
    try {
      const policyName = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
      const deleted = ledger.deletePolicy(policyName);
      if (!deleted) {
        res.status(404).json({ error: "Policy not found" });
        return;
      }
      res.json({ status: "deleted", name: policyName });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Reports ───────────────────────────────────────────────────────────

  router.get("/api/reports/:id", async (req, res) => {
    try {
      const session = await ledger.getSession(req.params.id);
      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      const events = await ledger.getEvents(session.id);
      const verification = await ledger.verifyChain(session.id);
      const compliance = await ledger.getComplianceBundle(session.id);

      const format = (req.query.format as string) || "json";

      if (format === "html") {
        const html = generateHtmlReport(session, events, verification, compliance);
        res.type("text/html").send(html);
      } else {
        res.json({
          session,
          events,
          verification,
          compliance,
          generated_at: new Date().toISOString(),
        });
      }
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── SSE Stream ────────────────────────────────────────────────────────

  router.get("/api/stream", sse.handler);

  return router;
}

/** Generate a simple HTML audit report. */
function generateHtmlReport(
  session: { id: string; goal: string; status: string; created_at: string; sealed_at: string | null },
  events: Array<{ sequence: number; payload: { type: string }; content_hash: string; created_at: string }>,
  verification: { verified: boolean; events_checked: number },
  compliance: { merkle_root: string },
): string {
  const rows = events
    .map(
      (e) =>
        `<tr><td>${e.sequence}</td><td>${e.payload.type}</td><td><code>${e.content_hash.slice(0, 16)}…</code></td><td>${e.created_at}</td></tr>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
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
  <p><strong>Created:</strong> ${session.created_at}</p>
  ${session.sealed_at ? `<p><strong>Sealed:</strong> ${session.sealed_at}</p>` : ""}
  <p><strong>Chain integrity:</strong>
    <span class="badge ${verification.verified ? "badge-ok" : "badge-fail"}">
      ${verification.verified ? "✓ Verified" : "✗ Broken"}
    </span>
    (${verification.events_checked} events)
  </p>
  <p><strong>Merkle root:</strong> <code>${compliance.merkle_root || "N/A"}</code></p>

  <h3>Event Log</h3>
  <table>
    <thead><tr><th>#</th><th>Type</th><th>Hash</th><th>Time</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <p style="margin-top: 2rem; color: #6b7280; font-size: 0.85rem;">
    Generated by EctoClaw v0.1.0 at ${new Date().toISOString()}
  </p>
</body>
</html>`;
}
