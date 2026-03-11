/**
 * Policy engine for EctoClaw.
 *
 * Evaluates OpenClaw agent actions against configurable audit policies.
 * Ported from EctoLedger's Rust PolicyEngine, adapted for OpenClaw's domain.
 */

import toml from "toml";
import type { AuditPolicy, EventPayload, MessageFilter } from "./schema.js";

export type PolicyDecision =
  | { action: "allow" }
  | { action: "deny"; reason: string }
  | { action: "redact"; label: string; pattern: string }
  | { action: "flag"; label: string; details: string }
  | { action: "require_approval"; gate_name: string; trigger: string };

export class PolicyEngine {
  private readonly policy: AuditPolicy;
  private readonly compiledFilters: Array<{ regex: RegExp; filter: MessageFilter }>;

  constructor(policy: AuditPolicy) {
    this.policy = policy;
    this.compiledFilters = (policy.message_filters ?? []).map((f) => ({
      regex: new RegExp(f.pattern, "gi"),
      filter: f,
    }));
  }

  /** Get the policy name. */
  get name(): string {
    return this.policy.name;
  }

  /** Get the raw policy object. */
  get raw(): AuditPolicy {
    return this.policy;
  }

  /** Validate an event payload against the policy. */
  evaluate(payload: EventPayload, currentStep: number): PolicyDecision {
    // Step limit
    if (this.policy.max_steps && currentStep >= this.policy.max_steps) {
      return { action: "deny", reason: `Step limit exceeded (max: ${this.policy.max_steps})` };
    }

    switch (payload.type) {
      case "SkillInvoked":
        return this.evaluateSkill(payload.skill_name);
      case "PluginAction":
        return this.evaluatePlugin(payload.plugin_name, payload.action);
      case "MessageSent":
      case "MessageReceived":
        return this.evaluateChannel(payload.channel, payload.content);
      case "ChannelEvent":
        return this.evaluateChannelAccess(payload.channel);
      default:
        return { action: "allow" };
    }
  }

  /** Check message content against filters. */
  filterContent(content: string): PolicyDecision {
    for (const { regex, filter } of this.compiledFilters) {
      regex.lastIndex = 0;
      if (regex.test(content)) {
        switch (filter.action) {
          case "redact":
            return { action: "redact", label: filter.label, pattern: filter.pattern };
          case "flag":
            return { action: "flag", label: filter.label, details: `Content matched: ${filter.label}` };
          case "block":
            return { action: "deny", reason: `Content blocked by filter: ${filter.label}` };
        }
      }
    }
    return { action: "allow" };
  }

  /** Check if a skill is allowed. */
  private evaluateSkill(skillName: string): PolicyDecision {
    const { forbidden_skills, allowed_skills } = this.policy;

    if (forbidden_skills?.includes(skillName)) {
      return { action: "deny", reason: `Skill '${skillName}' is forbidden by policy` };
    }

    if (allowed_skills && allowed_skills.length > 0 && !allowed_skills.includes(skillName)) {
      return { action: "deny", reason: `Skill '${skillName}' is not in the allowed list` };
    }

    // Check approval gates
    return this.checkApprovalGates("skill", skillName);
  }

  /** Check if a plugin action is allowed. */
  private evaluatePlugin(pluginName: string, action: string): PolicyDecision {
    const { forbidden_plugins, allowed_plugins } = this.policy;

    if (forbidden_plugins?.includes(pluginName)) {
      return { action: "deny", reason: `Plugin '${pluginName}' is forbidden by policy` };
    }

    if (allowed_plugins && allowed_plugins.length > 0 && !allowed_plugins.includes(pluginName)) {
      return { action: "deny", reason: `Plugin '${pluginName}' is not in the allowed list` };
    }

    return this.checkApprovalGates("plugin", `${pluginName}.${action}`);
  }

  /** Check if a channel is allowed and filter content. */
  private evaluateChannel(channel: string, content: string): PolicyDecision {
    const channelDecision = this.evaluateChannelAccess(channel);
    if (channelDecision.action !== "allow") return channelDecision;

    return this.filterContent(content);
  }

  /** Check if channel access is allowed. */
  private evaluateChannelAccess(channel: string): PolicyDecision {
    const { forbidden_channels, allowed_channels } = this.policy;

    if (forbidden_channels?.includes(channel)) {
      return { action: "deny", reason: `Channel '${channel}' is forbidden by policy` };
    }

    if (allowed_channels && allowed_channels.length > 0 && !allowed_channels.includes(channel)) {
      return { action: "deny", reason: `Channel '${channel}' is not in the allowed list` };
    }

    return { action: "allow" };
  }

  /** Check approval gates for an action. */
  private checkApprovalGates(actionType: string, actionName: string): PolicyDecision {
    for (const gate of this.policy.approval_gates ?? []) {
      const parts = gate.trigger.split("==").map((s) => s.trim());
      if (parts.length === 2) {
        const [field, value] = parts;
        if (
          (field === "action" && value === `'${actionType}'`) ||
          (field === "name" && value === `'${actionName}'`)
        ) {
          return {
            action: "require_approval",
            gate_name: gate.name,
            trigger: gate.trigger,
          };
        }
      }
    }
    return { action: "allow" };
  }
}

/** Parse a TOML policy string into an AuditPolicy. */
export function parsePolicy(tomlStr: string): AuditPolicy {
  return toml.parse(tomlStr) as AuditPolicy;
}
