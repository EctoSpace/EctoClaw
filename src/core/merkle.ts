/**
 * Binary Merkle tree for batch integrity verification.
 *
 * Ported from EctoLedger's Rust implementation.
 */

import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

export interface MerkleProofStep {
  side: "left" | "right";
  hash: string;
}

export interface MerkleTree {
  root: string;
  layers: string[][];
  leafCount: number;
}

export interface MerkleProof {
  leafIndex: number;
  leafHash: string;
  proof: MerkleProofStep[];
  root: string;
}

/** Hash a hex string's raw bytes to produce a leaf hash. */
function hashLeaf(hexStr: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(hexStr)));
}

/** Hash two sibling nodes by concatenating their raw bytes. */
function hashBranch(leftHex: string, rightHex: string): string {
  const leftBytes = hexToBytes(leftHex);
  const rightBytes = hexToBytes(rightHex);
  const combined = new Uint8Array(leftBytes.length + rightBytes.length);
  combined.set(leftBytes, 0);
  combined.set(rightBytes, leftBytes.length);
  return bytesToHex(sha256(combined));
}

/**
 * Build a binary Merkle tree from an array of content hashes.
 *
 * Odd-length layers are padded by duplicating the last element.
 */
export function buildMerkleTree(contentHashes: string[]): MerkleTree {
  if (contentHashes.length === 0) {
    throw new Error("Cannot build Merkle tree from empty input");
  }

  const layers: string[][] = [];

  // Leaf layer: hash each content hash string
  let currentLayer = contentHashes.map(hashLeaf);
  layers.push([...currentLayer]);

  // Build up to root
  while (currentLayer.length > 1) {
    if (currentLayer.length % 2 !== 0) {
      currentLayer.push(currentLayer[currentLayer.length - 1]);
    }
    const nextLayer: string[] = [];
    for (let i = 0; i < currentLayer.length; i += 2) {
      nextLayer.push(hashBranch(currentLayer[i], currentLayer[i + 1]));
    }
    currentLayer = nextLayer;
    layers.push([...currentLayer]);
  }

  return {
    root: currentLayer[0],
    layers,
    leafCount: contentHashes.length,
  };
}

/** Generate a Merkle proof for a given leaf index. */
export function generateProof(tree: MerkleTree, leafIndex: number): MerkleProof {
  if (leafIndex < 0 || leafIndex >= tree.leafCount) {
    throw new Error(`Leaf index ${leafIndex} out of range [0, ${tree.leafCount})`);
  }

  const proof: MerkleProofStep[] = [];
  let idx = leafIndex;

  for (let layerIdx = 0; layerIdx < tree.layers.length - 1; layerIdx++) {
    const layer = tree.layers[layerIdx];
    const isRight = idx % 2 === 1;
    const siblingIdx = isRight ? idx - 1 : idx + 1;

    if (siblingIdx < layer.length) {
      proof.push({
        side: isRight ? "left" : "right",
        hash: layer[siblingIdx],
      });
    }

    idx = Math.floor(idx / 2);
  }

  return {
    leafIndex,
    leafHash: tree.layers[0][leafIndex],
    proof,
    root: tree.root,
  };
}

/** Verify a Merkle proof against a root hash. */
export function verifyProof(rootHex: string, leafContentHash: string, proof: MerkleProof): boolean {
  let current = hashLeaf(leafContentHash);

  for (const step of proof.proof) {
    if (step.side === "left") {
      current = hashBranch(step.hash, current);
    } else {
      current = hashBranch(current, step.hash);
    }
  }

  return current === rootHex;
}
