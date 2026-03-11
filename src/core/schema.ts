/**
 * Schema definitions for EctoClaw ledger events.
 *
 * Adapted from EctoLedger's EventPayload to cover OpenClaw agent operations:
 * - Message routing (channels: WhatsApp, Telegram, Discord, etc.)
 * - Skill invocations and results
 * - Plugin actions
 * - Tool calls and results
 * - Memory operations
 * - LLM model interactions
 */

// ── Event Payload Types ─────────────────────────────────────────────────────

export type EventPayload =
  | { type: "Genesis"; message: string }
  | { type: "MessageReceived"; channel: string; sender: string; content: string; metadata?: Record<string, unknown> }
  | { type: "MessageSent"; channel: string; recipient: string; content: string; metadata?: Record<string, unknown> }
  | { type: "SkillInvoked"; skill_name: string; parameters: Record<string, unknown> }
  | { type: "SkillResult"; skill_name: string; result: unknown; success: boolean; duration_ms?: number }
  | { type: "PluginAction"; plugin_name: string; action: string; params: Record<string, unknown> }
  | { type: "PluginResult"; plugin_name: string; action: string; result: unknown; success: boolean }
  | { type: "ToolCall"; tool_name: string; arguments: Record<string, unknown> }
  | { type: "ToolResult"; tool_name: string; result: unknown; success: boolean; duration_ms?: number }
  | { type: "MemoryStore"; key: string; summary: string }
  | { type: "MemoryRecall"; query: string; results_count: number }
  | { type: "ModelRequest"; provider: string; model: string; prompt_tokens?: number }
  | { type: "ModelResponse"; provider: string; model: string; completion_tokens?: number; total_tokens?: number }
  | { type: "ChannelEvent"; channel: string; event_type: string; details: Record<string, unknown> }
  | { type: "Thought"; content: string }
  | { type: "ApprovalRequired"; gate_id: string; action_name: string; action_params_summary: string }
  | { type: "ApprovalDecision"; gate_id: string; approved: boolean; reason?: string }
  | { type: "PolicyViolation"; rule: string; action: string; details: string }
  | { type: "CrossLedgerSeal"; seal_hash: string; session_ids: string[]; session_tip_hashes: string[] }
  | { type: "KeyRotation"; new_public_key: string; rotation_index: number }
  | { type: "SessionSeal"; final_hash: string; event_count: number };

// ── Ledger Event Row ────────────────────────────────────────────────────────

export interface LedgerEvent {
  id: number;
  session_id: string;
  sequence: number;
  payload: EventPayload;
  content_hash: string;
  prev_hash: string;
  public_key: string | null;
  signature: string | null;
  created_at: string;
}

// ── Session ─────────────────────────────────────────────────────────────────

export type SessionStatus = "active" | "sealed" | "aborted";

export interface Session {
  id: string;
  goal: string;
  goal_hash: string;
  status: SessionStatus;
  policy_name: string | null;
  policy_hash: string | null;
  public_key: string;
  created_at: string;
  sealed_at: string | null;
  event_count: number;
  tip_hash: string | null;
}

// ── Append Result ───────────────────────────────────────────────────────────

export interface AppendResult {
  id: number;
  content_hash: string;
  sequence: number;
  signature: string;
}

// ── Compliance & Verification ───────────────────────────────────────────────

export interface ChainVerification {
  session_id: string;
  verified: boolean;
  events_checked: number;
  broken_at_sequence?: number;
}

export interface ComplianceBundle {
  session_id: string;
  events: Array<{ sequence: number; content_hash: string }>;
  merkle_root: string;
  policy_hash: string | null;
  generated_at: string;
}

// ── Metrics ─────────────────────────────────────────────────────────────────

export interface MetricsSummary {
  total_sessions: number;
  active_sessions: number;
  sealed_sessions: number;
  total_events: number;
  events_by_type: Record<string, number>;
}

export interface SecurityMetrics {
  policy_violations_7d: number;
  sessions_aborted: number;
  chain_verification_failures: number;
  blocked_skills: number;
  blocked_plugins: number;
}

// ── Policy Types ────────────────────────────────────────────────────────────

export interface AuditPolicy {
  name: string;
  description?: string;
  max_steps?: number;
  allowed_channels?: string[];
  forbidden_channels?: string[];
  allowed_skills?: string[];
  forbidden_skills?: string[];
  allowed_plugins?: string[];
  forbidden_plugins?: string[];
  message_filters?: MessageFilter[];
  approval_gates?: ApprovalGate[];
  rate_limits?: RateLimit[];
}

export interface MessageFilter {
  pattern: string;
  action: "redact" | "flag" | "block";
  label: string;
}

export interface ApprovalGate {
  name: string;
  trigger: string;
  description?: string;
}

export interface RateLimit {
  channel: string;
  max_per_minute: number;
}
