import { describe, it, expect } from "vitest";
import { PolicyEngine } from "../src/core/policy.js";
import type { AuditPolicy, EventPayload } from "../src/core/schema.js";

describe("PolicyEngine", () => {
  const basePolicy: AuditPolicy = {
    name: "test-policy",
    max_steps: 100,
    allowed_channels: ["whatsapp", "telegram"],
    forbidden_skills: ["dangerous-skill"],
    allowed_plugins: ["safe-plugin"],
    message_filters: [
      { pattern: "password\\s*[:=]\\s*\\S+", action: "redact", label: "credential" },
      { pattern: "DROP TABLE", action: "block", label: "sql-injection" },
    ],
  };

  it("allows valid events", () => {
    const engine = new PolicyEngine(basePolicy);
    const payload: EventPayload = { type: "MessageReceived", channel: "whatsapp", sender: "user", content: "hello" };
    const decision = engine.evaluate(payload, 0);
    expect(decision.action).toBe("allow");
  });

  it("denies forbidden skills", () => {
    const engine = new PolicyEngine(basePolicy);
    const payload: EventPayload = { type: "SkillInvoked", skill_name: "dangerous-skill", parameters: {} };
    const decision = engine.evaluate(payload, 0);
    expect(decision.action).toBe("deny");
  });

  it("denies unauthorized plugins", () => {
    const engine = new PolicyEngine(basePolicy);
    const payload: EventPayload = { type: "PluginAction", plugin_name: "unknown-plugin", action: "exec", params: {} };
    const decision = engine.evaluate(payload, 0);
    expect(decision.action).toBe("deny");
  });

  it("denies forbidden channels", () => {
    const engine = new PolicyEngine(basePolicy);
    const payload: EventPayload = { type: "MessageSent", channel: "irc", recipient: "user", content: "hi" };
    const decision = engine.evaluate(payload, 0);
    expect(decision.action).toBe("deny");
  });

  it("enforces step limits", () => {
    const engine = new PolicyEngine(basePolicy);
    const payload: EventPayload = { type: "Thought", content: "thinking" };
    const decision = engine.evaluate(payload, 100);
    expect(decision.action).toBe("deny");
  });

  it("blocks messages matching content filters", () => {
    const engine = new PolicyEngine(basePolicy);
    const payload: EventPayload = { type: "MessageSent", channel: "whatsapp", recipient: "user", content: "DROP TABLE users" };
    const decision = engine.evaluate(payload, 0);
    expect(decision.action).toBe("deny");
  });

  it("flags credential patterns for redaction", () => {
    const engine = new PolicyEngine(basePolicy);
    const decision = engine.filterContent("my password: secret123");
    expect(decision.action).toBe("redact");
  });

  it("collects no message filter matches for clean text", () => {
    const engine = new PolicyEngine(basePolicy);
    const result = engine.applyAllMessageFilters("hello world");
    expect(result.blocked).toBeUndefined();
    expect(result.redactions).toHaveLength(0);
    expect(result.flags).toHaveLength(0);
  });

  it("returns blocked result when block filter matches", () => {
    const engine = new PolicyEngine(basePolicy);
    const result = engine.applyAllMessageFilters("DROP TABLE users");
    expect(result.blocked).toBeDefined();
    expect(result.blocked?.label).toBe("sql-injection");
  });

  it("collects redaction matches for credential text", () => {
    const engine = new PolicyEngine(basePolicy);
    const result = engine.applyAllMessageFilters("password = hunter2");
    expect(result.blocked).toBeUndefined();
    expect(result.redactions).toHaveLength(1);
    expect(result.redactions[0].label).toBe("credential");
  });

  it("collects redact and flag matches together", () => {
    const policyWithFlag: AuditPolicy = {
      ...basePolicy,
      message_filters: [
        ...(basePolicy.message_filters ?? []),
        { pattern: "secret", action: "flag", label: "secret-keyword" },
      ],
    };
    const engine = new PolicyEngine(policyWithFlag);
    const result = engine.applyAllMessageFilters("password=abc and this is secret");
    expect(result.blocked).toBeUndefined();
    expect(result.redactions.map((item) => item.label)).toContain("credential");
    expect(result.flags.map((item) => item.label)).toContain("secret-keyword");
  });
});
