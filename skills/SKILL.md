---
name: ectoclaw-audit
description: Query and manage the EctoClaw cryptographic audit ledger for OpenClaw agents
version: 0.1.0
author: EctoSpace
---

# EctoClaw Audit Skill

This skill allows you to interact with the EctoClaw audit ledger from within OpenClaw conversations.

## Commands

### List Audit Sessions
When the user asks to see audit sessions, list recent sessions, or check audit history:
- Call GET {ECTOCLAW_URL}/api/sessions?limit=10
- Format the response as a readable list showing session ID, status, event count, and goal

### Verify Session Integrity
When the user asks to verify a session or check chain integrity:
- Call GET {ECTOCLAW_URL}/api/sessions/{session_id}/verify
- Report whether the chain is verified or broken

### Get Session Details
When the user asks about a specific session:
- Call GET {ECTOCLAW_URL}/api/sessions/{session_id}
- Show full session details including goal, status, timestamps, and event count

### Get Audit Metrics
When the user asks for metrics, statistics, or a summary:
- Call GET {ECTOCLAW_URL}/api/metrics
- Display total sessions, active sessions, sealed sessions, total events, and event type breakdown

### Get Compliance Bundle
When the user asks for a compliance report or Merkle proof:
- Call GET {ECTOCLAW_URL}/api/sessions/{session_id}/compliance
- Show the Merkle root and event hashes

### Generate Audit Report
When the user asks for a full audit report:
- Call GET {ECTOCLAW_URL}/api/reports/{session_id}
- Present the complete session report with events and verification status

## Configuration
- ECTOCLAW_URL: The EctoClaw server URL (default: http://localhost:3210)
