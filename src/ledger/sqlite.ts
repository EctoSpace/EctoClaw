/**
 * SQLite-backed implementation of LedgerBackend.
 * 
 * Uses better-sqlite3 for synchronous, high-performance SQLite access.
 * Zero-config: just point DATABASE_PATH at a file and go.
 */

import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { v4 as uuidv4 } from "uuid";
import { sha256Hex } from "../core/hash.js";
import { verifyChain as verifyHashChain } from "../core/hash.js";
import { buildMerkleTree } from "../core/merkle.js";
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
import type { CreateSessionParams, LedgerBackend } from "./backend.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export class SqliteLedger implements LedgerBackend {
  private db: Database.Database;

  constructor(dbPath: string = ":memory:") {
    // Ensure the parent directory exists for file-based databases
    if (dbPath !== ":memory:") {
      mkdirSync(dirname(resolve(dbPath)), { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  async initialize(): Promise<void> {
    // Try multiple possible locations for migrations
    const migrationPaths = [
      join(__dirname, "../../migrations/001_init.sql"),
      join(__dirname, "../../../migrations/001_init.sql"),
    ];
    
    let sql: string | null = null;
    for (const p of migrationPaths) {
      try {
        sql = readFileSync(p, "utf-8");
        break;
      } catch {
        // Try next path
      }
    }

    if (!sql) {
      // Inline fallback schema
      sql = `
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY, goal TEXT NOT NULL, goal_hash TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active', policy_name TEXT, policy_hash TEXT,
          public_key TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          sealed_at TEXT, event_count INTEGER NOT NULL DEFAULT 0, tip_hash TEXT
        );
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(id),
          sequence INTEGER NOT NULL, payload TEXT NOT NULL, content_hash TEXT NOT NULL,
          prev_hash TEXT NOT NULL, public_key TEXT, signature TEXT,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          UNIQUE(session_id, sequence)
        );
        CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, sequence);
        CREATE INDEX IF NOT EXISTS idx_events_hash ON events(content_hash);
        CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
        CREATE TABLE IF NOT EXISTS tokens (
          token_hash TEXT PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('admin', 'auditor', 'agent')), label TEXT,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE TABLE IF NOT EXISTS policies (
          name TEXT PRIMARY KEY, content TEXT NOT NULL, hash TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
      `;
    }

    this.db.exec(sql);
  }

  // ── Sessions ────────────────────────────────────────────────────────────

  async createSession(params: CreateSessionParams): Promise<Session> {
    const id = uuidv4();
    const goalHash = sha256Hex(params.goal);
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO sessions (id, goal, goal_hash, status, policy_name, policy_hash, public_key, created_at)
         VALUES (?, ?, ?, 'active', ?, ?, ?, ?)`,
      )
      .run(id, params.goal, goalHash, params.policyName ?? null, params.policyHash ?? null, params.publicKey, now);

    return {
      id,
      goal: params.goal,
      goal_hash: goalHash,
      status: "active",
      policy_name: params.policyName ?? null,
      policy_hash: params.policyHash ?? null,
      public_key: params.publicKey,
      created_at: now,
      sealed_at: null,
      event_count: 0,
      tip_hash: null,
    };
  }

  async getSession(sessionId: string): Promise<Session | null> {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as SessionRow | undefined;
    return row ? mapSession(row) : null;
  }

  async listSessions(limit = 50, offset = 0): Promise<Session[]> {
    const rows = this.db
      .prepare("SELECT * FROM sessions ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .all(limit, offset) as SessionRow[];
    return rows.map(mapSession);
  }

  async updateSessionStatus(sessionId: string, status: SessionStatus): Promise<void> {
    this.db.prepare("UPDATE sessions SET status = ? WHERE id = ?").run(status, sessionId);
  }

  async sealSession(sessionId: string, finalHash: string): Promise<void> {
    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE sessions SET status = 'sealed', sealed_at = ?, tip_hash = ? WHERE id = ?")
      .run(now, finalHash, sessionId);
  }

  // ── Events ──────────────────────────────────────────────────────────────

  async appendEvent(
    sessionId: string,
    payload: EventPayload,
    contentHash: string,
    prevHash: string,
    sequence: number,
    publicKey: string,
    signature: string,
  ): Promise<AppendResult> {
    const payloadJson = JSON.stringify(payload);

    const info = this.db
      .prepare(
        `INSERT INTO events (session_id, sequence, payload, content_hash, prev_hash, public_key, signature)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(sessionId, sequence, payloadJson, contentHash, prevHash, publicKey, signature);

    // Update session tip and event count
    this.db
      .prepare("UPDATE sessions SET event_count = event_count + 1, tip_hash = ? WHERE id = ?")
      .run(contentHash, sessionId);

    return {
      id: Number(info.lastInsertRowid),
      content_hash: contentHash,
      sequence,
      signature,
    };
  }

  async getEvents(sessionId: string): Promise<LedgerEvent[]> {
    const rows = this.db
      .prepare("SELECT * FROM events WHERE session_id = ? ORDER BY sequence ASC")
      .all(sessionId) as EventRow[];
    return rows.map(mapEvent);
  }

  async getLatest(sessionId: string): Promise<{ sequence: number; contentHash: string } | null> {
    const row = this.db
      .prepare("SELECT sequence, content_hash FROM events WHERE session_id = ? ORDER BY sequence DESC LIMIT 1")
      .get(sessionId) as { sequence: number; content_hash: string } | undefined;
    return row ? { sequence: row.sequence, contentHash: row.content_hash } : null;
  }

  async getEventById(eventId: number): Promise<LedgerEvent | null> {
    const row = this.db.prepare("SELECT * FROM events WHERE id = ?").get(eventId) as EventRow | undefined;
    return row ? mapEvent(row) : null;
  }

  // ── Verification ────────────────────────────────────────────────────────

  async verifyChain(sessionId: string): Promise<ChainVerification> {
    const events = await this.getEvents(sessionId);

    const chainEvents = events.map((e) => ({
      sequence: e.sequence,
      content_hash: e.content_hash,
      prev_hash: e.prev_hash,
      payload: e.payload,
    }));

    const verified = verifyHashChain(chainEvents);

    const result: ChainVerification = {
      session_id: sessionId,
      verified,
      events_checked: events.length,
    };

    if (!verified) {
      // Find the broken link
      for (let i = 1; i < chainEvents.length; i++) {
        if (chainEvents[i].prev_hash !== chainEvents[i - 1].content_hash) {
          result.broken_at_sequence = chainEvents[i].sequence;
          break;
        }
      }
    }

    return result;
  }

  // ── Compliance ──────────────────────────────────────────────────────────

  async getComplianceBundle(sessionId: string): Promise<ComplianceBundle> {
    const events = await this.getEvents(sessionId);
    const session = await this.getSession(sessionId);
    const hashes = events.map((e) => e.content_hash);

    let merkleRoot = "";
    if (hashes.length > 0) {
      const tree = buildMerkleTree(hashes);
      merkleRoot = tree.root;
    }

    return {
      session_id: sessionId,
      events: events.map((e) => ({
        sequence: e.sequence,
        content_hash: e.content_hash,
      })),
      merkle_root: merkleRoot,
      policy_hash: session?.policy_hash ?? null,
      generated_at: new Date().toISOString(),
    };
  }

  // ── Metrics ─────────────────────────────────────────────────────────────

  async getMetrics(): Promise<MetricsSummary> {
    const sessions = this.db.prepare("SELECT COUNT(*) as count FROM sessions").get() as { count: number };
    const active = this.db.prepare("SELECT COUNT(*) as count FROM sessions WHERE status = 'active'").get() as { count: number };
    const sealed = this.db.prepare("SELECT COUNT(*) as count FROM sessions WHERE status = 'sealed'").get() as { count: number };
    const events = this.db.prepare("SELECT COUNT(*) as count FROM events").get() as { count: number };

    // Count events by type
    const typeRows = this.db
      .prepare("SELECT json_extract(payload, '$.type') as type, COUNT(*) as count FROM events GROUP BY type")
      .all() as Array<{ type: string; count: number }>;

    const eventsByType: Record<string, number> = {};
    for (const row of typeRows) {
      eventsByType[row.type] = row.count;
    }

    return {
      total_sessions: sessions.count,
      active_sessions: active.count,
      sealed_sessions: sealed.count,
      total_events: events.count,
      events_by_type: eventsByType,
    };
  }

  async close(): Promise<void> {
    this.db.close();
  }

  // ── Token Management ────────────────────────────────────────────────────

  getTokenRole(tokenHash: string): string | null {
    const row = this.db.prepare("SELECT role FROM tokens WHERE token_hash = ?").get(tokenHash) as
      | { role: string }
      | undefined;
    return row?.role ?? null;
  }

  addToken(tokenHash: string, role: string, label?: string): void {
    this.db.prepare("INSERT INTO tokens (token_hash, role, label) VALUES (?, ?, ?)").run(tokenHash, role, label ?? null);
  }

  // ── Policy Storage ──────────────────────────────────────────────────────

  listPolicies(): string[] {
    const rows = this.db.prepare("SELECT name FROM policies ORDER BY name").all() as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  getPolicy(name: string): { content: string; hash: string } | null {
    const row = this.db.prepare("SELECT content, hash FROM policies WHERE name = ?").get(name) as
      | { content: string; hash: string }
      | undefined;
    return row ?? null;
  }

  savePolicy(name: string, content: string): void {
    const hash = sha256Hex(content);
    this.db
      .prepare(
        `INSERT INTO policies (name, content, hash, updated_at) VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT(name) DO UPDATE SET content = ?, hash = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      )
      .run(name, content, hash, content, hash);
  }

  deletePolicy(name: string): boolean {
    const info = this.db.prepare("DELETE FROM policies WHERE name = ?").run(name);
    return info.changes > 0;
  }
}

// ── Internal Types & Mappers ────────────────────────────────────────────────

interface SessionRow {
  id: string;
  goal: string;
  goal_hash: string;
  status: string;
  policy_name: string | null;
  policy_hash: string | null;
  public_key: string;
  created_at: string;
  sealed_at: string | null;
  event_count: number;
  tip_hash: string | null;
}

interface EventRow {
  id: number;
  session_id: string;
  sequence: number;
  payload: string;
  content_hash: string;
  prev_hash: string;
  public_key: string | null;
  signature: string | null;
  created_at: string;
}

function mapSession(row: SessionRow): Session {
  return {
    id: row.id,
    goal: row.goal,
    goal_hash: row.goal_hash,
    status: row.status as SessionStatus,
    policy_name: row.policy_name,
    policy_hash: row.policy_hash,
    public_key: row.public_key,
    created_at: row.created_at,
    sealed_at: row.sealed_at,
    event_count: row.event_count,
    tip_hash: row.tip_hash,
  };
}

function mapEvent(row: EventRow): LedgerEvent {
  return {
    id: row.id,
    session_id: row.session_id,
    sequence: row.sequence,
    payload: JSON.parse(row.payload),
    content_hash: row.content_hash,
    prev_hash: row.prev_hash,
    public_key: row.public_key,
    signature: row.signature,
    created_at: row.created_at,
  };
}
