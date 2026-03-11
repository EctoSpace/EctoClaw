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
});
