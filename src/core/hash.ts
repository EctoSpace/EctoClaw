/**
 * SHA-256 hash chain utilities for EctoClaw.
 *
 * Ported from EctoLedger's Rust implementation.
 * Chain linking: SHA256(previous_hash \0 sequence \0 payload_json)
 */

import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

/** The hash used as the "previous" link for the very first event. */
export const GENESIS_PREVIOUS_HASH =
  "0000000000000000000000000000000000000000000000000000000000000000";

/**
 * Compute the content hash for a ledger event.
 *
 * Uses null-byte delimiters between fields to prevent boundary-shift collisions.
 * Matches EctoLedger: SHA256(previous_hash \0 sequence \0 payload_json)
 */
export function computeContentHash(
  previousHash: string,
  sequence: number,
  payloadJson: string,
): string {
  const encoder = new TextEncoder();
  const parts = [
    encoder.encode(previousHash),
    new Uint8Array([0x00]),
    encoder.encode(String(sequence)),
    new Uint8Array([0x00]),
    encoder.encode(payloadJson),
  ];

  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const buffer = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    buffer.set(part, offset);
    offset += part.length;
  }

  return bytesToHex(sha256(buffer));
}

/** Compute a simple SHA-256 hex digest of a UTF-8 string. */
export function sha256Hex(input: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(input)));
}

/**
 * Pair-hash two hex strings using length-prefixed encoding.
 *
 * Format: SHA256(len(a):u64_BE || a_bytes || len(b):u64_BE || b_bytes)
 * Used for cross-ledger seals and attestation layers.
 */
export function pairHash(a: string, b: string): string {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);

  const buffer = new Uint8Array(8 + aBytes.length + 8 + bBytes.length);
  const view = new DataView(buffer.buffer);

  view.setBigUint64(0, BigInt(aBytes.length), false); // big-endian
  buffer.set(aBytes, 8);
  view.setBigUint64(8 + aBytes.length, BigInt(bBytes.length), false);
  buffer.set(bBytes, 8 + aBytes.length + 8);

  return bytesToHex(sha256(buffer));
}

/**
 * Verify a hash chain between two events.
 * Returns true if every link is intact.
 */
export function verifyChain(
  events: Array<{ sequence: number; content_hash: string; prev_hash: string; payload: unknown }>,
): boolean {
  if (events.length === 0) return true;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const expectedPrev = i === 0 ? GENESIS_PREVIOUS_HASH : events[i - 1].content_hash;

    if (event.prev_hash !== expectedPrev) {
      return false;
    }

    const computed = computeContentHash(
      event.prev_hash,
      event.sequence,
      JSON.stringify(event.payload),
    );

    if (computed !== event.content_hash) {
      return false;
    }
  }

  return true;
}
