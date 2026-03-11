import { describe, it, expect, beforeEach } from "vitest";
import { SqliteLedger } from "../src/ledger/sqlite.js";
import { computeContentHash, GENESIS_PREVIOUS_HASH } from "../src/core/hash.js";
import { generateKeyPair, signContentHash } from "../src/core/signing.js";
import type { EventPayload } from "../src/core/schema.js";

describe("SqliteLedger", () => {
  let ledger: SqliteLedger;

  beforeEach(async () => {
    ledger = new SqliteLedger(":memory:");
    await ledger.initialize();
  });

  describe("sessions", () => {
    it("creates and retrieves a session", async () => {
      const kp = await generateKeyPair();
      const session = await ledger.createSession({
        goal: "Test OpenClaw audit",
        publicKey: kp.publicKey,
      });
      expect(session.id).toBeTruthy();
      expect(session.goal).toBe("Test OpenClaw audit");
      expect(session.status).toBe("active");
      expect(session.event_count).toBe(0);

      const retrieved = await ledger.getSession(session.id);
      expect(retrieved).toBeTruthy();
      expect(retrieved!.id).toBe(session.id);
    });

    it("lists sessions", async () => {
      const kp = await generateKeyPair();
      await ledger.createSession({ goal: "Session 1", publicKey: kp.publicKey });
      await ledger.createSession({ goal: "Session 2", publicKey: kp.publicKey });
      const sessions = await ledger.listSessions();
      expect(sessions.length).toBe(2);
    });

    it("seals a session", async () => {
      const kp = await generateKeyPair();
      const session = await ledger.createSession({ goal: "Test", publicKey: kp.publicKey });
      await ledger.sealSession(session.id, "finalhash");
      const sealed = await ledger.getSession(session.id);
      expect(sealed!.status).toBe("sealed");
      expect(sealed!.sealed_at).toBeTruthy();
    });
  });

  describe("events", () => {
    it("appends and retrieves events", async () => {
      const kp = await generateKeyPair();
      const session = await ledger.createSession({ goal: "Test", publicKey: kp.publicKey });

      const payload: EventPayload = { type: "Genesis", message: "test" };
      const payloadJson = JSON.stringify(payload);
      const contentHash = computeContentHash(GENESIS_PREVIOUS_HASH, 0, payloadJson);
      const signature = await signContentHash(kp.privateKey, contentHash);

      const result = await ledger.appendEvent(
        session.id, payload, contentHash, GENESIS_PREVIOUS_HASH, 0, kp.publicKey, signature,
      );
      expect(result.id).toBeTruthy();
      expect(result.content_hash).toBe(contentHash);
      expect(result.sequence).toBe(0);

      const events = await ledger.getEvents(session.id);
      expect(events.length).toBe(1);
      expect(events[0].payload.type).toBe("Genesis");
    });

    it("maintains correct tip hash", async () => {
      const kp = await generateKeyPair();
      const session = await ledger.createSession({ goal: "Test", publicKey: kp.publicKey });

      const p0: EventPayload = { type: "Genesis", message: "start" };
      const h0 = computeContentHash(GENESIS_PREVIOUS_HASH, 0, JSON.stringify(p0));
      const s0 = await signContentHash(kp.privateKey, h0);
      await ledger.appendEvent(session.id, p0, h0, GENESIS_PREVIOUS_HASH, 0, kp.publicKey, s0);

      const p1: EventPayload = { type: "MessageReceived", channel: "telegram", sender: "user1", content: "hello" };
      const h1 = computeContentHash(h0, 1, JSON.stringify(p1));
      const s1 = await signContentHash(kp.privateKey, h1);
      await ledger.appendEvent(session.id, p1, h1, h0, 1, kp.publicKey, s1);

      const latest = await ledger.getLatest(session.id);
      expect(latest!.sequence).toBe(1);
      expect(latest!.contentHash).toBe(h1);
    });
  });

  describe("verification", () => {
    it("verifies a valid chain", async () => {
      const kp = await generateKeyPair();
      const session = await ledger.createSession({ goal: "Test", publicKey: kp.publicKey });

      const p0: EventPayload = { type: "Genesis", message: "start" };
      const h0 = computeContentHash(GENESIS_PREVIOUS_HASH, 0, JSON.stringify(p0));
      const s0 = await signContentHash(kp.privateKey, h0);
      await ledger.appendEvent(session.id, p0, h0, GENESIS_PREVIOUS_HASH, 0, kp.publicKey, s0);

      const p1: EventPayload = { type: "SkillInvoked", skill_name: "weather", parameters: { city: "NYC" } };
      const h1 = computeContentHash(h0, 1, JSON.stringify(p1));
      const s1 = await signContentHash(kp.privateKey, h1);
      await ledger.appendEvent(session.id, p1, h1, h0, 1, kp.publicKey, s1);

      const result = await ledger.verifyChain(session.id);
      expect(result.verified).toBe(true);
      expect(result.events_checked).toBe(2);
    });
  });

  describe("compliance", () => {
    it("generates a compliance bundle with Merkle root", async () => {
      const kp = await generateKeyPair();
      const session = await ledger.createSession({ goal: "Test", publicKey: kp.publicKey });

      const p0: EventPayload = { type: "Genesis", message: "start" };
      const h0 = computeContentHash(GENESIS_PREVIOUS_HASH, 0, JSON.stringify(p0));
      const s0 = await signContentHash(kp.privateKey, h0);
      await ledger.appendEvent(session.id, p0, h0, GENESIS_PREVIOUS_HASH, 0, kp.publicKey, s0);

      const bundle = await ledger.getComplianceBundle(session.id);
      expect(bundle.session_id).toBe(session.id);
      expect(bundle.events.length).toBe(1);
      expect(bundle.merkle_root).toHaveLength(64);
    });
  });

  describe("metrics", () => {
    it("returns correct metrics", async () => {
      const kp = await generateKeyPair();
      const s1 = await ledger.createSession({ goal: "Session 1", publicKey: kp.publicKey });
      await ledger.createSession({ goal: "Session 2", publicKey: kp.publicKey });

      const p: EventPayload = { type: "Genesis", message: "test" };
      const h = computeContentHash(GENESIS_PREVIOUS_HASH, 0, JSON.stringify(p));
      const sig = await signContentHash(kp.privateKey, h);
      await ledger.appendEvent(s1.id, p, h, GENESIS_PREVIOUS_HASH, 0, kp.publicKey, sig);

      const metrics = await ledger.getMetrics();
      expect(metrics.total_sessions).toBe(2);
      expect(metrics.active_sessions).toBe(2);
      expect(metrics.total_events).toBe(1);
      expect(metrics.events_by_type["Genesis"]).toBe(1);
    });
  });
});
