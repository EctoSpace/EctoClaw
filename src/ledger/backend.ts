/**
 * LedgerBackend — abstract interface for the EctoClaw cryptographic ledger.
 * 
 * Mirrors EctoLedger's `LedgerBackend` trait, adapted for TypeScript.
 * Implementations must be stateless (all state in the backing store).
 */

import type {
  AppendResult,
  ChainVerification,
  ComplianceBundle,
  EventPayload,
  LedgerEvent,
  MetricsSummary,
  Session,
  SessionStatus,
} from "../core/schema.js";

export interface CreateSessionParams {
  goal: string;
  policyName?: string;
  policyHash?: string;
  publicKey: string;
}

export interface LedgerBackend {
  /** Initialize the backend (run migrations, create tables, etc.). */
  initialize(): Promise<void>;

  // ── Sessions ────────────────────────────────────────────────────────────

  /** Create a new audit session. */
  createSession(params: CreateSessionParams): Promise<Session>;

  /** Get a session by ID. */
  getSession(sessionId: string): Promise<Session | null>;

  /** List sessions, ordered by creation time descending. */
  listSessions(limit?: number, offset?: number): Promise<Session[]>;

  /** Update session status. */
  updateSessionStatus(sessionId: string, status: SessionStatus): Promise<void>;

  /** Seal a session, setting its final hash and seal timestamp. */
  sealSession(sessionId: string, finalHash: string): Promise<void>;

  // ── Events ──────────────────────────────────────────────────────────────

  /** Append a new event to the ledger. Returns the appended event summary. */
  appendEvent(
    sessionId: string,
    payload: EventPayload,
    contentHash: string,
    prevHash: string,
    sequence: number,
    publicKey: string,
    signature: string,
  ): Promise<AppendResult>;

  /** Get all events for a session, ordered by sequence. */
  getEvents(sessionId: string): Promise<LedgerEvent[]>;

  /** Get the latest event for a session (tip of the chain). */
  getLatest(sessionId: string): Promise<{ sequence: number; contentHash: string } | null>;

  /** Get a single event by ID. */
  getEventById(eventId: number): Promise<LedgerEvent | null>;

  // ── Verification ────────────────────────────────────────────────────────

  /** Verify the hash chain for a session. */
  verifyChain(sessionId: string): Promise<ChainVerification>;

  // ── Compliance ──────────────────────────────────────────────────────────

  /** Generate a compliance bundle for a session. */
  getComplianceBundle(sessionId: string): Promise<ComplianceBundle>;

  // ── Metrics ─────────────────────────────────────────────────────────────

  /** Get aggregate metrics. */
  getMetrics(): Promise<MetricsSummary>;

  /** Close the backend (release connections, etc.). */
  close(): Promise<void>;
}
