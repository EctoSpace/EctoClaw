/**
 * EctoClaw OpenClaw Plugin
 *
 * Integrates EctoClaw's cryptographic audit ledger with OpenClaw's gateway.
 * When loaded as an OpenClaw plugin, it automatically intercepts and records:
 *   - Incoming/outgoing messages
 *   - Skill invocations and results
 *   - Plugin actions
 *   - Tool calls
 *   - Memory operations
 *   - Model requests/responses
 *
 * Installation:
 *   openclaw plugins install ectoclaw
 *
 * Configuration (in ~/.openclaw/config.yaml):
 *   plugins:
 *     entries:
 *       - name: ectoclaw
 *         config:
 *           ledger_url: http://localhost:3210
 *           api_token: your-token
 *           auto_record: true
 *           session_per_conversation: true
 */

import { EctoClawClient } from "../sdk/client.js";
import type { EventPayload } from "../core/schema.js";

export interface EctoClawPluginConfig {
  /** EctoClaw server URL. Default: http://localhost:3210 */
  ledger_url?: string;
  /** Bearer token for EctoClaw API. */
  api_token?: string;
  /** Automatically record all events. Default: true */
  auto_record?: boolean;
  /** Create a new session per conversation. Default: true */
  session_per_conversation?: boolean;
  /** Default goal for auto-created sessions. */
  default_goal?: string;
  /** Policy to apply to sessions. */
  policy_name?: string;
}

/**
 * EctoClaw Plugin for OpenClaw.
 *
 * Can be used standalone or as an OpenClaw plugin.
 * Provides methods to record various agent events to the audit ledger.
 */
export class EctoClawPlugin {
  private client: EctoClawClient;
  private config: Required<EctoClawPluginConfig>;
  private sessionMap = new Map<string, string>(); // conversationId → sessionId
  private defaultSessionId: string | null = null;

  constructor(config: EctoClawPluginConfig = {}) {
    this.config = {
      ledger_url: config.ledger_url ?? "http://localhost:3210",
      api_token: config.api_token ?? "",
      auto_record: config.auto_record ?? true,
      session_per_conversation: config.session_per_conversation ?? true,
      default_goal: config.default_goal ?? "OpenClaw agent session",
      policy_name: config.policy_name ?? "",
    };

    this.client = new EctoClawClient({
      baseUrl: this.config.ledger_url,
      bearerToken: this.config.api_token,
    });
  }

  /** Get or create a session for a conversation. */
  async getSessionId(conversationId?: string): Promise<string> {
    if (conversationId && this.config.session_per_conversation) {
      const existing = this.sessionMap.get(conversationId);
      if (existing) return existing;

      const session = await this.client.createSession({
        goal: `${this.config.default_goal} [${conversationId}]`,
        policy_name: this.config.policy_name || undefined,
      });
      this.sessionMap.set(conversationId, session.id);
      return session.id;
    }

    if (!this.defaultSessionId) {
      const session = await this.client.createSession({
        goal: this.config.default_goal,
        policy_name: this.config.policy_name || undefined,
      });
      this.defaultSessionId = session.id;
    }
    return this.defaultSessionId;
  }

  // ── Event Recording Methods ─────────────────────────────────────────

  /** Record an incoming message. */
  async recordMessageReceived(
    channel: string,
    sender: string,
    content: string,
    conversationId?: string,
    metadata?: Record<string, unknown>,
  ) {
    if (!this.config.auto_record) return;
    const sessionId = await this.getSessionId(conversationId);
    const payload: EventPayload = {
      type: "MessageReceived",
      channel,
      sender,
      content,
      metadata,
    };
    return this.client.appendEvent(sessionId, payload);
  }

  /** Record an outgoing message. */
  async recordMessageSent(
    channel: string,
    recipient: string,
    content: string,
    conversationId?: string,
    metadata?: Record<string, unknown>,
  ) {
    if (!this.config.auto_record) return;
    const sessionId = await this.getSessionId(conversationId);
    const payload: EventPayload = {
      type: "MessageSent",
      channel,
      recipient,
      content,
      metadata,
    };
    return this.client.appendEvent(sessionId, payload);
  }

  /** Record a skill invocation. */
  async recordSkillInvoked(
    skillName: string,
    parameters: Record<string, unknown>,
    conversationId?: string,
  ) {
    if (!this.config.auto_record) return;
    const sessionId = await this.getSessionId(conversationId);
    const payload: EventPayload = {
      type: "SkillInvoked",
      skill_name: skillName,
      parameters,
    };
    return this.client.appendEvent(sessionId, payload);
  }

  /** Record a skill result. */
  async recordSkillResult(
    skillName: string,
    result: unknown,
    success: boolean,
    durationMs?: number,
    conversationId?: string,
  ) {
    if (!this.config.auto_record) return;
    const sessionId = await this.getSessionId(conversationId);
    const payload: EventPayload = {
      type: "SkillResult",
      skill_name: skillName,
      result,
      success,
      duration_ms: durationMs,
    };
    return this.client.appendEvent(sessionId, payload);
  }

  /** Record a plugin action. */
  async recordPluginAction(
    pluginName: string,
    action: string,
    params: Record<string, unknown>,
    conversationId?: string,
  ) {
    if (!this.config.auto_record) return;
    const sessionId = await this.getSessionId(conversationId);
    const payload: EventPayload = {
      type: "PluginAction",
      plugin_name: pluginName,
      action,
      params,
    };
    return this.client.appendEvent(sessionId, payload);
  }

  /** Record a tool call. */
  async recordToolCall(
    toolName: string,
    args: Record<string, unknown>,
    conversationId?: string,
  ) {
    if (!this.config.auto_record) return;
    const sessionId = await this.getSessionId(conversationId);
    const payload: EventPayload = {
      type: "ToolCall",
      tool_name: toolName,
      arguments: args,
    };
    return this.client.appendEvent(sessionId, payload);
  }

  /** Record a tool result. */
  async recordToolResult(
    toolName: string,
    result: unknown,
    success: boolean,
    durationMs?: number,
    conversationId?: string,
  ) {
    if (!this.config.auto_record) return;
    const sessionId = await this.getSessionId(conversationId);
    const payload: EventPayload = {
      type: "ToolResult",
      tool_name: toolName,
      result,
      success,
      duration_ms: durationMs,
    };
    return this.client.appendEvent(sessionId, payload);
  }

  /** Record a model request. */
  async recordModelRequest(
    provider: string,
    model: string,
    promptTokens?: number,
    conversationId?: string,
  ) {
    if (!this.config.auto_record) return;
    const sessionId = await this.getSessionId(conversationId);
    const payload: EventPayload = {
      type: "ModelRequest",
      provider,
      model,
      prompt_tokens: promptTokens,
    };
    return this.client.appendEvent(sessionId, payload);
  }

  /** Record a model response. */
  async recordModelResponse(
    provider: string,
    model: string,
    completionTokens?: number,
    totalTokens?: number,
    conversationId?: string,
  ) {
    if (!this.config.auto_record) return;
    const sessionId = await this.getSessionId(conversationId);
    const payload: EventPayload = {
      type: "ModelResponse",
      provider,
      model,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
    };
    return this.client.appendEvent(sessionId, payload);
  }

  /** Record a memory store operation. */
  async recordMemoryStore(key: string, summary: string, conversationId?: string) {
    if (!this.config.auto_record) return;
    const sessionId = await this.getSessionId(conversationId);
    const payload: EventPayload = { type: "MemoryStore", key, summary };
    return this.client.appendEvent(sessionId, payload);
  }

  /** Record a memory recall operation. */
  async recordMemoryRecall(query: string, resultsCount: number, conversationId?: string) {
    if (!this.config.auto_record) return;
    const sessionId = await this.getSessionId(conversationId);
    const payload: EventPayload = { type: "MemoryRecall", query, results_count: resultsCount };
    return this.client.appendEvent(sessionId, payload);
  }

  /** Record a generic event payload directly. */
  async recordEvent(payload: EventPayload, conversationId?: string) {
    const sessionId = await this.getSessionId(conversationId);
    return this.client.appendEvent(sessionId, payload);
  }

  /** Seal a conversation's session. */
  async sealSession(conversationId?: string) {
    const sessionId = conversationId
      ? this.sessionMap.get(conversationId)
      : this.defaultSessionId;
    if (sessionId) {
      await this.client.sealSession(sessionId);
      if (conversationId) {
        this.sessionMap.delete(conversationId);
      } else {
        this.defaultSessionId = null;
      }
    }
  }

  /** Verify a session's chain integrity. */
  async verifySession(conversationId?: string) {
    const sessionId = conversationId
      ? this.sessionMap.get(conversationId)
      : this.defaultSessionId;
    if (!sessionId) return null;
    return this.client.verifyChain(sessionId);
  }

  /** Get the underlying SDK client for advanced operations. */
  getClient(): EctoClawClient {
    return this.client;
  }
}

/**
 * OpenClaw plugin manifest factory.
 * Returns the plugin registration object that OpenClaw expects.
 */
export function createOpenClawPlugin(config: EctoClawPluginConfig = {}) {
  const plugin = new EctoClawPlugin(config);

  return {
    name: "ectoclaw",
    version: "0.1.0",
    description: "Cryptographic audit ledger for OpenClaw agents",

    /** Called when the plugin is loaded by OpenClaw. */
    async onLoad() {
      console.log("🦞 EctoClaw audit ledger plugin loaded");
    },

    /** Hook into message pipeline. */
    hooks: {
      /** Before a message is processed. */
      async onMessageReceived(ctx: {
        channel: string;
        sender: string;
        content: string;
        conversationId?: string;
        metadata?: Record<string, unknown>;
      }) {
        await plugin.recordMessageReceived(
          ctx.channel, ctx.sender, ctx.content,
          ctx.conversationId, ctx.metadata,
        );
      },

      /** After a message is sent. */
      async onMessageSent(ctx: {
        channel: string;
        recipient: string;
        content: string;
        conversationId?: string;
        metadata?: Record<string, unknown>;
      }) {
        await plugin.recordMessageSent(
          ctx.channel, ctx.recipient, ctx.content,
          ctx.conversationId, ctx.metadata,
        );
      },

      /** Before a skill is invoked. */
      async onSkillInvoked(ctx: {
        skillName: string;
        parameters: Record<string, unknown>;
        conversationId?: string;
      }) {
        await plugin.recordSkillInvoked(ctx.skillName, ctx.parameters, ctx.conversationId);
      },

      /** After a skill completes. */
      async onSkillResult(ctx: {
        skillName: string;
        result: unknown;
        success: boolean;
        durationMs?: number;
        conversationId?: string;
      }) {
        await plugin.recordSkillResult(
          ctx.skillName, ctx.result, ctx.success,
          ctx.durationMs, ctx.conversationId,
        );
      },

      /** Before a tool is called. */
      async onToolCall(ctx: {
        toolName: string;
        arguments: Record<string, unknown>;
        conversationId?: string;
      }) {
        await plugin.recordToolCall(ctx.toolName, ctx.arguments, ctx.conversationId);
      },

      /** After a tool returns. */
      async onToolResult(ctx: {
        toolName: string;
        result: unknown;
        success: boolean;
        durationMs?: number;
        conversationId?: string;
      }) {
        await plugin.recordToolResult(
          ctx.toolName, ctx.result, ctx.success,
          ctx.durationMs, ctx.conversationId,
        );
      },

      /** When the agent makes an LLM request. */
      async onModelRequest(ctx: {
        provider: string;
        model: string;
        promptTokens?: number;
        conversationId?: string;
      }) {
        await plugin.recordModelRequest(
          ctx.provider, ctx.model, ctx.promptTokens, ctx.conversationId,
        );
      },

      /** When the agent receives an LLM response. */
      async onModelResponse(ctx: {
        provider: string;
        model: string;
        completionTokens?: number;
        totalTokens?: number;
        conversationId?: string;
      }) {
        await plugin.recordModelResponse(
          ctx.provider, ctx.model, ctx.completionTokens,
          ctx.totalTokens, ctx.conversationId,
        );
      },
    },

    /** Direct access to the plugin instance. */
    instance: plugin,
  };
}

export default createOpenClawPlugin;
