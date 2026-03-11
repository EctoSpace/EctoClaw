import { describe, it, expect } from "vitest";
import {
  computeContentHash,
  sha256Hex,
  pairHash,
  verifyChain,
  GENESIS_PREVIOUS_HASH,
} from "../src/core/hash.js";

describe("sha256Hex", () => {
  it("produces consistent hashes", () => {
    const h1 = sha256Hex("hello");
    const h2 = sha256Hex("hello");
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  it("produces different hashes for different inputs", () => {
    expect(sha256Hex("hello")).not.toBe(sha256Hex("world"));
  });
});

describe("computeContentHash", () => {
  it("produces a 64-char hex hash", () => {
    const hash = computeContentHash(GENESIS_PREVIOUS_HASH, 0, '{"type":"Genesis","message":"test"}');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    const payload = '{"type":"Genesis","message":"test"}';
    const h1 = computeContentHash(GENESIS_PREVIOUS_HASH, 0, payload);
    const h2 = computeContentHash(GENESIS_PREVIOUS_HASH, 0, payload);
    expect(h1).toBe(h2);
  });

  it("changes with different previous hash", () => {
    const payload = '{"type":"Genesis","message":"test"}';
    const h1 = computeContentHash(GENESIS_PREVIOUS_HASH, 0, payload);
    const h2 = computeContentHash(sha256Hex("other"), 0, payload);
    expect(h1).not.toBe(h2);
  });

  it("changes with different sequence", () => {
    const payload = '{"type":"Genesis","message":"test"}';
    const h1 = computeContentHash(GENESIS_PREVIOUS_HASH, 0, payload);
    const h2 = computeContentHash(GENESIS_PREVIOUS_HASH, 1, payload);
    expect(h1).not.toBe(h2);
  });
});

describe("pairHash", () => {
  it("is deterministic", () => {
    const h1 = pairHash("abc", "def");
    const h2 = pairHash("abc", "def");
    expect(h1).toBe(h2);
  });

  it("is order-dependent", () => {
    const h1 = pairHash("abc", "def");
    const h2 = pairHash("def", "abc");
    expect(h1).not.toBe(h2);
  });
});

describe("verifyChain", () => {
  it("returns true for empty chain", () => {
    expect(verifyChain([])).toBe(true);
  });

  it("verifies a valid single-event chain", () => {
    const payload = { type: "Genesis", message: "test" };
    const hash = computeContentHash(GENESIS_PREVIOUS_HASH, 0, JSON.stringify(payload));
    expect(
      verifyChain([
        { sequence: 0, content_hash: hash, prev_hash: GENESIS_PREVIOUS_HASH, payload },
      ]),
    ).toBe(true);
  });

  it("verifies a valid multi-event chain", () => {
    const p0 = { type: "Genesis", message: "start" };
    const h0 = computeContentHash(GENESIS_PREVIOUS_HASH, 0, JSON.stringify(p0));

    const p1 = { type: "MessageReceived", channel: "whatsapp", sender: "user", content: "hi" };
    const h1 = computeContentHash(h0, 1, JSON.stringify(p1));

    const p2 = { type: "MessageSent", channel: "whatsapp", recipient: "user", content: "hello!" };
    const h2 = computeContentHash(h1, 2, JSON.stringify(p2));

    expect(
      verifyChain([
        { sequence: 0, content_hash: h0, prev_hash: GENESIS_PREVIOUS_HASH, payload: p0 },
        { sequence: 1, content_hash: h1, prev_hash: h0, payload: p1 },
        { sequence: 2, content_hash: h2, prev_hash: h1, payload: p2 },
      ]),
    ).toBe(true);
  });

  it("detects a broken chain", () => {
    const p0 = { type: "Genesis", message: "start" };
    const h0 = computeContentHash(GENESIS_PREVIOUS_HASH, 0, JSON.stringify(p0));

    expect(
      verifyChain([
        { sequence: 0, content_hash: h0, prev_hash: GENESIS_PREVIOUS_HASH, payload: p0 },
        { sequence: 1, content_hash: "tampered", prev_hash: h0, payload: { type: "Thought", content: "bad" } },
      ]),
    ).toBe(false);
  });
});
