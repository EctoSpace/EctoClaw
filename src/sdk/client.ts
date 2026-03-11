/**
 * EctoClaw SDK Client
 *
 * TypeScript REST client for the EctoClaw audit ledger API.
 * Mirrors EctoLedger's EctoLedgerClient, adapted for EctoClaw.
 *
 * @example
 * ```ts
 * const client = new EctoClawClient({
 *   baseUrl: "http://localhost:3210",
 *   bearerToken: "your-token",
 * });
 * const session = await client.createSession({ goal: "Audit WhatsApp bot" });
 * await client.appendEvent(session.id, { type: "MessageReceived", channel: "whatsapp", sender: "user", content: "hello" });
 * const ok = await client.verifyChain(session.id);
 * ```
 */

import type {
  AppendResult,
  ChainVerification,
  ComplianceBundle,
  EventPayload,
  LedgerEvent,
  MetricsSummary,
  Session,
} from "../core/schema.js";

export class EctoClawApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    method: string,
    url: string,
  ) {
    super(`EctoClaw API ${method} ${url} → ${status}: ${body}`);
    this.name = "EctoClawApiError";
  }
}

export interface EctoClawClientOptions {
  baseUrl?: string;
  bearerToken?: string;
  timeout?: number;
}

export interface CreateSessionOptions {
  goal: string;
  policy_name?: string;
}

export class EctoClawClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly timeout: number;

  constructor(options: EctoClawClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "http://localhost:3210").replace(/\/$/, "");
    this.headers = { "Content-Type": "application/json" };
    this.timeout = options.timeout ?? 30_000;
    if (options.bearerToken) {
      this.headers["Authorization"] = `Bearer ${options.bearerToken}`;
    }
  }

  // ── Sessions ──────────────────────────────────────────────────────────

  async listSessions(limit = 50): Promise<Session[]> {
    return this.get<Session[]>(`/api/sessions?limit=${limit}`);
  }

  async getSession(sessionId: string): Promise<Session | null> {
    try {
      return await this.get<Session>(`/api/sessions/${encodeURIComponent(sessionId)}`);
    } catch (err) {
      if (err instanceof EctoClawApiError && err.status === 404) return null;
      throw err;
    }
  }

  async createSession(opts: CreateSessionOptions): Promise<Session> {
    return this.post<Session>("/api/sessions", opts);
  }

  async sealSession(sessionId: string): Promise<{ status: string; session_id: string }> {
    return this.post(`/api/sessions/${encodeURIComponent(sessionId)}/seal`, {});
  }

  // ── Events ──────────────────────────────────────────────────────────────

  async getEvents(sessionId: string): Promise<LedgerEvent[]> {
    return this.get<LedgerEvent[]>(`/api/events?session_id=${encodeURIComponent(sessionId)}`);
  }

  async appendEvent(sessionId: string, payload: EventPayload): Promise<AppendResult> {
    return this.post<AppendResult>(
      `/api/sessions/${encodeURIComponent(sessionId)}/events`,
      payload,
    );
  }

  // ── Verification ────────────────────────────────────────────────────────

  async verifyChain(sessionId: string): Promise<ChainVerification> {
    return this.get<ChainVerification>(`/api/sessions/${encodeURIComponent(sessionId)}/verify`);
  }

  // ── Compliance ──────────────────────────────────────────────────────────

  async getComplianceBundle(sessionId: string): Promise<ComplianceBundle> {
    return this.get<ComplianceBundle>(`/api/sessions/${encodeURIComponent(sessionId)}/compliance`);
  }

  // ── Reports ───────────────────────────────────────────────────────────

  async getReport(sessionId: string, format: "json" | "html" = "json"): Promise<unknown> {
    return this.get(`/api/reports/${encodeURIComponent(sessionId)}?format=${format}`);
  }

  // ── Merkle ────────────────────────────────────────────────────────────

  async getMerkleRoot(sessionId: string): Promise<{ root: string; leaf_count: number }> {
    return this.get(`/api/sessions/${encodeURIComponent(sessionId)}/merkle`);
  }

  async getMerkleProof(sessionId: string, leafIndex: number) {
    return this.get(`/api/sessions/${encodeURIComponent(sessionId)}/merkle?leaf=${leafIndex}`);
  }

  // ── Metrics ─────────────────────────────────────────────────────────────

  async getMetrics(): Promise<MetricsSummary> {
    return this.get<MetricsSummary>("/api/metrics");
  }

  // ── Policies ──────────────────────────────────────────────────────────

  async listPolicies(): Promise<string[]> {
    return this.get<string[]>("/api/policies");
  }

  async getPolicy(name: string): Promise<string> {
    const url = `${this.baseUrl}/api/policies/${encodeURIComponent(name)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await fetch(url, { headers: this.headers, signal: controller.signal });
      if (!res.ok) throw new EctoClawApiError(res.status, await res.text(), "GET", url);
      return res.text();
    } finally {
      clearTimeout(timeout);
    }
  }

  async savePolicy(name: string, content: string): Promise<void> {
    const url = `${this.baseUrl}/api/policies/${encodeURIComponent(name)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await fetch(url, {
        method: "PUT",
        headers: { ...this.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
        signal: controller.signal,
      });
      if (!res.ok) throw new EctoClawApiError(res.status, await res.text(), "PUT", url);
    } finally {
      clearTimeout(timeout);
    }
  }

  // ── Health ──────────────────────────────────────────────────────────────

  async health(): Promise<{ status: string; version: string; name: string }> {
    return this.get("/health");
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private async get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await fetch(url, { headers: this.headers, signal: controller.signal });
      if (!res.ok) throw new EctoClawApiError(res.status, await res.text(), "GET", url);
      return res.json() as Promise<T>;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) throw new EctoClawApiError(res.status, await res.text(), "POST", url);
      return res.json() as Promise<T>;
    } finally {
      clearTimeout(timeout);
    }
  }
}
