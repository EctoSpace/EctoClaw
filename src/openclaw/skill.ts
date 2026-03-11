/**
 * EctoClaw Skill for OpenClaw
 *
 * Provides natural-language commands for interacting with the audit ledger
 * from within OpenClaw conversations.
 */

import { EctoClawClient } from "../sdk/client.js";

export interface SkillConfig {
  ledgerUrl: string;
  apiToken?: string;
}

/**
 * Creates skill handlers for OpenClaw's skill system.
 * These map natural language intents to EctoClaw API operations.
 */
export function createSkillHandlers(config: SkillConfig) {
  const client = new EctoClawClient({
    baseUrl: config.ledgerUrl,
    bearerToken: config.apiToken,
  });

  return {
    /** List recent audit sessions. */
    async listSessions(limit = 10): Promise<string> {
      const sessions = await client.listSessions(limit);
      if (sessions.length === 0) return "No audit sessions found.";

      const lines = sessions.map(
        (s) =>
          `• ${s.id.slice(0, 8)}… | ${s.status.padEnd(7)} | ${s.event_count} events | ${s.goal.slice(0, 50)}`,
      );
      return `📋 Recent Audit Sessions:\n${lines.join("\n")}`;
    },

    /** Verify a session's integrity. */
    async verifySession(sessionId: string): Promise<string> {
      const result = await client.verifyChain(sessionId);
      if (result.verified) {
        return `✅ Session ${sessionId.slice(0, 8)}… chain VERIFIED (${result.events_checked} events checked)`;
      }
      return `❌ Session ${sessionId.slice(0, 8)}… chain BROKEN at sequence ${result.broken_at_sequence}`;
    },

    /** Get session details. */
    async getSession(sessionId: string): Promise<string> {
      const session = await client.getSession(sessionId);
      if (!session) return `Session ${sessionId} not found.`;

      return [
        `🦞 Session Details:`,
        `  ID: ${session.id}`,
        `  Goal: ${session.goal}`,
        `  Status: ${session.status}`,
        `  Events: ${session.event_count}`,
        `  Created: ${session.created_at}`,
        session.sealed_at ? `  Sealed: ${session.sealed_at}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    },

    /** Get ledger metrics. */
    async getMetrics(): Promise<string> {
      const m = await client.getMetrics();
      return [
        `📊 EctoClaw Metrics:`,
        `  Sessions: ${m.total_sessions} total (${m.active_sessions} active, ${m.sealed_sessions} sealed)`,
        `  Events: ${m.total_events} total`,
        Object.keys(m.events_by_type).length > 0
          ? `  By type: ${Object.entries(m.events_by_type).map(([t, c]) => `${t}(${c})`).join(", ")}`
          : null,
      ]
        .filter(Boolean)
        .join("\n");
    },
  };
}
