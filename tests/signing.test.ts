import { describe, it, expect } from "vitest";
import { generateKeyPair, signContentHash, verifySignature } from "../src/core/signing.js";

describe("generateKeyPair", () => {
  it("generates hex-encoded keys", async () => {
    const kp = await generateKeyPair();
    expect(kp.privateKey).toMatch(/^[0-9a-f]{64}$/);
    expect(kp.publicKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generates unique keys each time", async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();
    expect(kp1.privateKey).not.toBe(kp2.privateKey);
  });
});

describe("signContentHash + verifySignature", () => {
  it("signs and verifies correctly", async () => {
    const kp = await generateKeyPair();
    const contentHash = "abcdef1234567890".repeat(4);
    const sig = await signContentHash(kp.privateKey, contentHash);
    expect(sig).toHaveLength(128); // 64 bytes → 128 hex chars

    const valid = await verifySignature(kp.publicKey, contentHash, sig);
    expect(valid).toBe(true);
  });

  it("rejects tampered content", async () => {
    const kp = await generateKeyPair();
    const sig = await signContentHash(kp.privateKey, "original");
    const valid = await verifySignature(kp.publicKey, "tampered", sig);
    expect(valid).toBe(false);
  });

  it("rejects wrong public key", async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();
    const sig = await signContentHash(kp1.privateKey, "test");
    const valid = await verifySignature(kp2.publicKey, "test", sig);
    expect(valid).toBe(false);
  });
});
