/**
 * Ed25519 digital signature utilities for EctoClaw.
 *
 * Each session generates an ephemeral Ed25519 keypair.
 * Every event's content hash is signed, creating a non-repudiable audit trail.
 */

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

// ed25519 requires sha512 for internal use
ed.etc.sha512Async = (...messages: Uint8Array[]) => {
  return Promise.resolve(sha512(ed.etc.concatBytes(...messages)));
};

export interface KeyPair {
  privateKey: string; // hex
  publicKey: string; // hex
}

/** Generate a new Ed25519 keypair. Returns hex-encoded keys. */
export async function generateKeyPair(): Promise<KeyPair> {
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return {
    privateKey: bytesToHex(privateKey),
    publicKey: bytesToHex(publicKey),
  };
}

/** Sign a content hash (hex string) with a private key (hex string). Returns signature hex. */
export async function signContentHash(
  privateKeyHex: string,
  contentHash: string,
): Promise<string> {
  const msgBytes = new TextEncoder().encode(contentHash);
  const signature = await ed.signAsync(msgBytes, privateKeyHex);
  return bytesToHex(signature);
}

/** Verify a signature against a content hash and public key. All inputs are hex strings. */
export async function verifySignature(
  publicKeyHex: string,
  contentHash: string,
  signatureHex: string,
): Promise<boolean> {
  try {
    const msgBytes = new TextEncoder().encode(contentHash);
    const sigBytes = hexToBytes(signatureHex);
    const pubBytes = hexToBytes(publicKeyHex);
    return await ed.verifyAsync(sigBytes, msgBytes, pubBytes);
  } catch {
    return false;
  }
}
