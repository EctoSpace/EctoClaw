import { describe, it, expect } from "vitest";
import { buildMerkleTree, generateProof, verifyProof } from "../src/core/merkle.js";

describe("buildMerkleTree", () => {
  it("throws on empty input", () => {
    expect(() => buildMerkleTree([])).toThrow("Cannot build Merkle tree from empty input");
  });

  it("builds a tree with one leaf", () => {
    const tree = buildMerkleTree(["abc123"]);
    expect(tree.root).toHaveLength(64);
    expect(tree.leafCount).toBe(1);
  });

  it("builds a tree with multiple leaves", () => {
    const tree = buildMerkleTree(["hash1", "hash2", "hash3", "hash4"]);
    expect(tree.root).toHaveLength(64);
    expect(tree.leafCount).toBe(4);
    expect(tree.layers.length).toBeGreaterThan(1);
  });

  it("handles odd number of leaves", () => {
    const tree = buildMerkleTree(["a", "b", "c"]);
    expect(tree.root).toHaveLength(64);
    expect(tree.leafCount).toBe(3);
  });
});

describe("generateProof + verifyProof", () => {
  it("generates valid proofs for all leaves", () => {
    const hashes = ["hash_a", "hash_b", "hash_c", "hash_d"];
    const tree = buildMerkleTree(hashes);

    for (let i = 0; i < hashes.length; i++) {
      const proof = generateProof(tree, i);
      expect(proof.leafIndex).toBe(i);
      expect(proof.root).toBe(tree.root);

      const valid = verifyProof(tree.root, hashes[i], proof);
      expect(valid).toBe(true);
    }
  });

  it("rejects proof with wrong leaf", () => {
    const tree = buildMerkleTree(["a", "b", "c", "d"]);
    const proof = generateProof(tree, 0);
    const valid = verifyProof(tree.root, "wrong_hash", proof);
    expect(valid).toBe(false);
  });

  it("rejects proof with wrong root", () => {
    const tree = buildMerkleTree(["a", "b"]);
    const proof = generateProof(tree, 0);
    const valid = verifyProof("0".repeat(64), "a", proof);
    expect(valid).toBe(false);
  });

  it("throws for out-of-range index", () => {
    const tree = buildMerkleTree(["a", "b"]);
    expect(() => generateProof(tree, 5)).toThrow("out of range");
  });

  it("rejects a tampered proof path", () => {
    const hashes = ["hash1", "hash2", "hash3", "hash4"];
    const tree = buildMerkleTree(hashes);
    const proof = generateProof(tree, 0);
    // Tamper with one sibling hash in the proof path
    if (proof.proof.length > 0) {
      proof.proof[0] = { ...proof.proof[0], hash: "0".repeat(64) };
    }
    const valid = verifyProof(tree.root, hashes[0], proof);
    expect(valid).toBe(false);
  });
});
