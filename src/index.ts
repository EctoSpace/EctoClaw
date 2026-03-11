/**
 * EctoClaw — Cryptographic audit ledger for OpenClaw AI agents
 *
 * @example
 * ```ts
 * import { EctoClawClient, EctoClawPlugin } from "ectoclaw";
 * 
 * // SDK usage
 * const client = new EctoClawClient({ baseUrl: "http://localhost:3210" });
 * 
 * // Plugin usage
 * const plugin = new EctoClawPlugin({ ledger_url: "http://localhost:3210" });
 * await plugin.recordMessageReceived("whatsapp", "user", "Hello!");
 * ```
 */

// SDK Client
export { EctoClawClient, EctoClawApiError } from "./sdk/client.js";
export type { EctoClawClientOptions, CreateSessionOptions } from "./sdk/client.js";

// OpenClaw Plugin
export { EctoClawPlugin, createOpenClawPlugin } from "./openclaw/plugin.js";
export type { EctoClawPluginConfig } from "./openclaw/plugin.js";

// Core types
export type {
  EventPayload,
  LedgerEvent,
  Session,
  SessionStatus,
  AppendResult,
  ChainVerification,
  ComplianceBundle,
  MetricsSummary,
  SecurityMetrics,
  AuditPolicy,
} from "./core/schema.js";

// Crypto utilities
export { computeContentHash, sha256Hex, verifyChain, GENESIS_PREVIOUS_HASH } from "./core/hash.js";
export { generateKeyPair, signContentHash, verifySignature } from "./core/signing.js";
export { buildMerkleTree, generateProof, verifyProof } from "./core/merkle.js";

// Policy engine
export { PolicyEngine } from "./core/policy.js";
