/**
 * EctoClaw HTTP server.
 * 
 * Express-based REST API with SSE streaming, bearer auth, and CORS.
 */

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import express from "express";
import cors from "cors";
import { SqliteLedger } from "../ledger/sqlite.js";
import { sha256Hex } from "../core/hash.js";
import { createAuthMiddleware } from "./auth.js";
import { SSEBroadcaster } from "./sse.js";
import { createRoutes } from "./routes.js";

export interface ServerConfig {
  port: number;
  host: string;
  dbPath: string;
  devMode: boolean;
  adminToken?: string;
}

export async function createServer(config: ServerConfig) {
  // Ensure the data directory exists before opening the database
  const dataDir = dirname(resolve(config.dbPath));
  mkdirSync(dataDir, { recursive: true });

  const ledger = new SqliteLedger(config.dbPath);
  await ledger.initialize();

  // Ensure admin token exists
  if (config.adminToken) {
    const tokenHash = sha256Hex(config.adminToken);
    const existing = ledger.getTokenRole(tokenHash);
    if (!existing) {
      ledger.addToken(tokenHash, "admin", "default-admin");
    }
  }

  const sse = new SSEBroadcaster();
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(express.text({ type: "text/plain", limit: "1mb" }));

  // Rate limiting (per-IP, sliding window)
  const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
  const RATE_LIMIT_WINDOW_MS = 60_000;
  const RATE_LIMIT_MAX = 300;
  app.use((req, res, next) => {
    if (req.path === "/api/stream" || req.path === "/health" || req.path === "/" || req.path.startsWith("/dashboard")) {
      next();
      return;
    }
    const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    let entry = rateLimitMap.get(ip);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
      rateLimitMap.set(ip, entry);
    }
    entry.count++;
    if (entry.count > RATE_LIMIT_MAX) {
      res.status(429).json({ error: "Rate limit exceeded" });
      return;
    }
    next();
  });

  // Auth middleware (skip for SSE and health)
  app.use((req, res, next) => {
    if (req.path === "/api/stream" || req.path === "/health" || req.path === "/" || req.path.startsWith("/dashboard")) {
      next();
      return;
    }
    createAuthMiddleware(ledger, config.devMode)(req, res, next);
  });

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", version: "0.1.0", name: "ectoclaw" });
  });

  // API routes
  app.use(createRoutes(ledger, sse, dataDir));

  // Dashboard (static files)
  app.get("/", (_req, res) => {
    res.redirect("/dashboard/");
  });

  app.get("/dashboard/", (_req, res) => {
    // Serve inline dashboard HTML
    res.type("text/html").send(getDashboardHTML());
  });

  return { app, ledger, sse };
}

export async function startServer(config: ServerConfig): Promise<void> {
  const { app, ledger } = await createServer(config);

  const server = app.listen(config.port, config.host, () => {
    console.log(`
┌─────────────────────────────────────────────────┐
│                                                 │
│   🦞 EctoClaw Audit Ledger                      │
│                                                 │
│   Server running at:                            │
│   http://${config.host}:${config.port}                        │
│                                                 │
│   Dashboard:  http://localhost:${config.port}/dashboard/   │
│   API:        http://localhost:${config.port}/api/         │
│   SSE Stream: http://localhost:${config.port}/api/stream   │
│   Health:     http://localhost:${config.port}/health       │
│                                                 │
│   Dev mode: ${config.devMode ? "ON (no auth required)" : "OFF"}                     │
│                                                 │
└─────────────────────────────────────────────────┘
`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down EctoClaw...");
    server.close();
    await ledger.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function getDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EctoClaw Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }
    .header { background: linear-gradient(135deg, #1e3a5f 0%, #0f172a 100%); padding: 1.5rem 2rem; border-bottom: 1px solid #334155; }
    .header h1 { font-size: 1.5rem; display: flex; align-items: center; gap: 0.5rem; }
    .header h1 span { font-size: 1.8rem; }
    .container { max-width: 1200px; margin: 0 auto; padding: 1.5rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .card { background: #1e293b; border-radius: 8px; padding: 1.25rem; border: 1px solid #334155; }
    .card h3 { font-size: 0.75rem; text-transform: uppercase; color: #94a3b8; margin-bottom: 0.5rem; letter-spacing: 0.05em; }
    .card .value { font-size: 2rem; font-weight: 700; color: #38bdf8; }
    .section { margin-bottom: 2rem; }
    .section h2 { font-size: 1.1rem; margin-bottom: 1rem; color: #f1f5f9; }
    table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 8px; overflow: hidden; }
    th { background: #334155; padding: 0.75rem 1rem; text-align: left; font-size: 0.75rem; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.05em; }
    td { padding: 0.75rem 1rem; border-top: 1px solid #334155; font-size: 0.875rem; }
    .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; }
    .badge-active { background: #064e3b; color: #6ee7b7; }
    .badge-sealed { background: #1e3a5f; color: #93c5fd; }
    .badge-aborted { background: #7f1d1d; color: #fca5a5; }
    code { background: #334155; padding: 0.1rem 0.3rem; border-radius: 3px; font-size: 0.8rem; color: #38bdf8; }
    .events-feed { max-height: 400px; overflow-y: auto; }
    .event-item { padding: 0.75rem 1rem; border-bottom: 1px solid #334155; display: flex; gap: 1rem; align-items: center; }
    .event-type { font-weight: 600; min-width: 140px; }
    .event-time { color: #64748b; font-size: 0.8rem; margin-left: auto; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; animation: pulse 2s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
    .status-bar { display: flex; align-items: center; gap: 0.5rem; color: #94a3b8; font-size: 0.8rem; padding: 0.5rem 0; }
    #error-banner { display: none; background: #7f1d1d; color: #fca5a5; padding: 0.75rem 1rem; border-radius: 8px; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <div class="header">
    <h1><span>🦞</span> EctoClaw Dashboard</h1>
  </div>

  <div class="container">
    <div id="error-banner"></div>

    <div class="grid">
      <div class="card"><h3>Total Sessions</h3><div class="value" id="total-sessions">-</div></div>
      <div class="card"><h3>Active Sessions</h3><div class="value" id="active-sessions">-</div></div>
      <div class="card"><h3>Sealed Sessions</h3><div class="value" id="sealed-sessions">-</div></div>
      <div class="card"><h3>Total Events</h3><div class="value" id="total-events">-</div></div>
    </div>

    <div class="section">
      <h2>Recent Sessions</h2>
      <table>
        <thead><tr><th>ID</th><th>Goal</th><th>Status</th><th>Events</th><th>Created</th></tr></thead>
        <tbody id="sessions-body"><tr><td colspan="5" style="text-align:center;color:#64748b">Loading...</td></tr></tbody>
      </table>
    </div>

    <div class="section">
      <h2>Live Event Feed</h2>
      <div class="status-bar"><div class="dot" id="sse-dot"></div><span id="sse-status">Connecting...</span></div>
      <div class="card events-feed" id="events-feed">
        <div style="text-align:center;color:#64748b;padding:2rem">Waiting for events...</div>
      </div>
    </div>
  </div>

  <script>
    const API = window.location.origin;

    async function fetchMetrics() {
      try {
        const res = await fetch(API + '/api/metrics');
        const m = await res.json();
        document.getElementById('total-sessions').textContent = m.total_sessions;
        document.getElementById('active-sessions').textContent = m.active_sessions;
        document.getElementById('sealed-sessions').textContent = m.sealed_sessions;
        document.getElementById('total-events').textContent = m.total_events;
      } catch (e) {
        showError('Failed to fetch metrics: ' + e.message);
      }
    }

    async function fetchSessions() {
      try {
        const res = await fetch(API + '/api/sessions?limit=20');
        const sessions = await res.json();
        const tbody = document.getElementById('sessions-body');
        if (sessions.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#64748b">No sessions yet</td></tr>';
          return;
        }
        tbody.innerHTML = sessions.map(s =>
          '<tr>' +
          '<td><code>' + s.id.slice(0, 8) + '...</code></td>' +
          '<td>' + escapeHtml(s.goal.slice(0, 60)) + '</td>' +
          '<td><span class="badge badge-' + s.status + '">' + s.status + '</span></td>' +
          '<td>' + s.event_count + '</td>' +
          '<td>' + new Date(s.created_at).toLocaleString() + '</td>' +
          '</tr>'
        ).join('');
      } catch (e) {
        showError('Failed to fetch sessions: ' + e.message);
      }
    }

    function connectSSE() {
      const es = new EventSource(API + '/api/stream');
      const dot = document.getElementById('sse-dot');
      const status = document.getElementById('sse-status');

      es.addEventListener('connected', () => {
        dot.style.background = '#22c55e';
        status.textContent = 'Connected — streaming live events';
      });

      es.addEventListener('event_appended', (e) => {
        const data = JSON.parse(e.data);
        addEventToFeed(data.event_type, data.session_id, data.sequence);
        fetchMetrics();
      });

      es.addEventListener('session_created', (e) => {
        const data = JSON.parse(e.data);
        addEventToFeed('SessionCreated', data.session_id, 0);
        fetchSessions();
        fetchMetrics();
      });

      es.addEventListener('session_sealed', (e) => {
        const data = JSON.parse(e.data);
        addEventToFeed('SessionSealed', data.session_id, '-');
        fetchSessions();
        fetchMetrics();
      });

      es.addEventListener('policy_violation', (e) => {
        const data = JSON.parse(e.data);
        addEventToFeed('PolicyViolation', data.session_id, data.reason);
      });

      es.onerror = () => {
        dot.style.background = '#ef4444';
        status.textContent = 'Disconnected — reconnecting...';
      };
    }

    function addEventToFeed(type, sessionId, detail) {
      const feed = document.getElementById('events-feed');
      if (feed.querySelector('div[style]')) feed.innerHTML = '';
      const item = document.createElement('div');
      item.className = 'event-item';
      item.innerHTML =
        '<span class="event-type">' + escapeHtml(type) + '</span>' +
        '<code>' + sessionId.slice(0, 8) + '...</code>' +
        '<span>' + escapeHtml(String(detail)) + '</span>' +
        '<span class="event-time">' + new Date().toLocaleTimeString() + '</span>';
      feed.insertBefore(item, feed.firstChild);
      if (feed.children.length > 50) feed.removeChild(feed.lastChild);
    }

    function showError(msg) {
      const banner = document.getElementById('error-banner');
      banner.textContent = msg;
      banner.style.display = 'block';
      setTimeout(() => { banner.style.display = 'none'; }, 5000);
    }

    function escapeHtml(text) {
      const d = document.createElement('div');
      d.textContent = text;
      return d.innerHTML;
    }

    fetchMetrics();
    fetchSessions();
    connectSSE();
    setInterval(fetchMetrics, 30000);
  </script>
</body>
</html>`;
}
