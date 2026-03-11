#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────────
# EctoClaw Demo Script (Bash — macOS / Linux only)
#
# NOTE: For a cross-platform version that works on Windows, macOS, and Linux,
#       use the TypeScript demo instead:
#
#         npm run demo          (or: npx tsx scripts/demo.ts)
#
# Starts the dev server, opens the dashboard, then populates it with a
# realistic set of audit sessions and events so you can see everything live.
#
# Usage:
#   bash scripts/demo.sh
#
# Options:
#   PORT=3210          Override the server port   (default: 3210)
#   KEEP_DB=1          Keep the test database after exit (default: delete it)
# ────────────────────────────────────────────────────────────────────────────

set -euo pipefail

PORT="${PORT:-3210}"
BASE="http://localhost:${PORT}"
DB_PATH="/tmp/ectoclaw-demo-$$.db"
SERVER_PID=""
OWNS_SERVER=0  # 1 if we started the server ourselves

# ── Colours ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

log()  { echo -e "${CYAN}[ectoclaw]${RESET} $*"; }
ok()   { echo -e "${GREEN}  ✓${RESET} $*"; }
warn() { echo -e "${YELLOW}  !${RESET} $*"; }
err()  { echo -e "${RED}  ✗${RESET} $*"; }
sep()  { echo -e "${BOLD}────────────────────────────────────────────────────${RESET}"; }

# ── Cleanup ──────────────────────────────────────────────────────────────────
cleanup() {
  echo ""
  if [[ "$OWNS_SERVER" == "1" ]]; then
    log "Shutting down..."
    if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
      kill "$SERVER_PID" 2>/dev/null || true
      ok "Server stopped (PID $SERVER_PID)"
    fi
    if [[ "${KEEP_DB:-0}" != "1" ]] && [[ -f "$DB_PATH" ]]; then
      rm -f "$DB_PATH"
      ok "Cleaned up demo database"
    else
      warn "Database kept at: $DB_PATH"
    fi
  fi
}
trap cleanup EXIT INT TERM

# ── Helpers ──────────────────────────────────────────────────────────────────

# POST JSON, print response, return session id if present
post() {
  local path="$1"; shift
  curl -s -X POST "${BASE}${path}" \
    -H "Content-Type: application/json" \
    -d "$@"
}

# GET JSON
get() {
  curl -s "${BASE}$1"
}

# Extract a field from JSON without jq dependency
json_field() {
  local json="$1" field="$2"
  echo "$json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$field',''))" 2>/dev/null \
    || echo "$json" | grep -o "\"${field}\":\"[^\"]*\"" | head -1 | cut -d'"' -f4
}

# Wait until the health endpoint responds
wait_for_server() {
  local retries=30
  while [[ $retries -gt 0 ]]; do
    if curl -sf "${BASE}/health" > /dev/null 2>&1; then
      return 0
    fi
    sleep 0.3
    (( retries-- ))
  done
  err "Server did not start within 9 seconds"
  exit 1
}

# Create a session, return its ID
create_session() {
  local goal="$1" policy="${2:-}"
  local body="{\"goal\":\"${goal}\""
  [[ -n "$policy" ]] && body+=",\"policy_name\":\"${policy}\""
  body+="}"
  local resp
  resp=$(post "/api/sessions" "$body")
  json_field "$resp" "id"
}

# Append an event to a session
event() {
  local sid="$1"; shift
  post "/api/sessions/${sid}/events" "$@" > /dev/null
}

# Seal a session
seal() {
  post "/api/sessions/$1/seal" '{}' > /dev/null
}

# Open a URL in the default browser (macOS / Linux)
open_browser() {
  local url="$1"
  if command -v open &>/dev/null; then
    open "$url"
  elif command -v xdg-open &>/dev/null; then
    xdg-open "$url" &
  else
    warn "Could not detect a browser opener — visit manually: $url"
  fi
}

# ── Header ───────────────────────────────────────────────────────────────────
sep
echo -e "${BOLD}🦞  EctoClaw Demo${RESET}"
sep

# ── Step 1: Start server ─────────────────────────────────────────────────────

# If something is already listening on the port, reuse it instead of starting a new one
if curl -sf "${BASE}/health" > /dev/null 2>&1; then
  warn "Server already running on port ${PORT} — reusing it"
  OWNS_SERVER=0
else
  log "Starting EctoClaw dev server on port ${PORT}..."

  # Prefer built dist; fall back to tsx for dev
  if [[ -f "dist/cli/index.js" ]]; then
    node dist/cli/index.js serve --dev --port "$PORT" --db "$DB_PATH" &
  else
    npx --yes tsx src/cli/index.ts serve --dev --port "$PORT" --db "$DB_PATH" &
  fi
  SERVER_PID=$!
  OWNS_SERVER=1

  wait_for_server
  ok "Server ready at ${BASE}"
fi

# ── Step 2: Open dashboard ────────────────────────────────────────────────────
log "Opening dashboard..."
open_browser "${BASE}/dashboard/"
sleep 1   # give the browser a moment to load before events start streaming

# ── Step 3: Populate data ─────────────────────────────────────────────────────
sep
log "Populating demo data..."
sep

# ── Session 1: WhatsApp bot ───────────────────────────────────────────────────
log "Creating session 1 — WhatsApp customer support bot"
S1=$(create_session "WhatsApp customer support — order inquiry")

event "$S1" '{"type":"MessageReceived","channel":"whatsapp","sender":"user:customer_42","content":"Hi, where is my order #98765?"}'
sleep 0.2
event "$S1" '{"type":"SkillInvoked","skill":"order-lookup","parameters":{"order_id":"98765"}}'
sleep 0.2
event "$S1" '{"type":"ToolCall","tool":"db_query","arguments":{"table":"orders","order_id":"98765"}}'
sleep 0.2
event "$S1" '{"type":"ToolResult","tool":"db_query","result":{"status":"shipped","eta":"2026-02-28"},"success":true}'
sleep 0.2
event "$S1" '{"type":"ModelRequest","model":"gpt-4o","prompt":"Summarise the order status for the customer"}'
sleep 0.2
event "$S1" '{"type":"ModelResponse","model":"gpt-4o","response":"Your order #98765 has shipped and arrives tomorrow, Feb 28.","tokens_used":42}'
sleep 0.2
event "$S1" '{"type":"MessageSent","channel":"whatsapp","recipient":"user:customer_42","content":"Your order #98765 has shipped! Estimated arrival: Feb 28."}'
seal "$S1"
ok "Session 1 sealed — 7 events"

# ── Session 2: Telegram news bot ──────────────────────────────────────────────
log "Creating session 2 — Telegram news summary bot"
S2=$(create_session "Telegram daily news digest — 2026-02-27")

event "$S2" '{"type":"SkillInvoked","skill":"web-search","parameters":{"query":"top news today 2026-02-27","limit":5}}'
sleep 0.2
event "$S2" '{"type":"ToolCall","tool":"http_get","arguments":{"url":"https://newsapi.example.com/top?date=2026-02-27"}}'
sleep 0.2
event "$S2" '{"type":"ToolResult","tool":"http_get","result":{"articles":["AI breakthrough","Market rally","Climate accord"]},"success":true}'
sleep 0.2
event "$S2" '{"type":"AgentThought","thought":"I have 3 articles — summarising for digest"}'
sleep 0.2
event "$S2" '{"type":"ModelRequest","model":"claude-3-5-sonnet","prompt":"Summarise these headlines into a 3-sentence digest"}'
sleep 0.2
event "$S2" '{"type":"ModelResponse","model":"claude-3-5-sonnet","response":"AI saw a major breakthrough today. Markets rallied 2.3%. A new climate accord was signed by 50 nations.","tokens_used":78}'
sleep 0.2
event "$S2" '{"type":"MessageSent","channel":"telegram","recipient":"channel:daily_news","content":"📰 Daily Digest: AI breakthrough, markets +2.3%, climate accord signed."}'
seal "$S2"
ok "Session 2 sealed — 7 events"

# ── Session 3: Still active — real-time streaming ────────────────────────────
log "Creating session 3 — Discord moderation bot (stays active)"
S3=$(create_session "Discord moderation — #general channel monitoring")

event "$S3" '{"type":"MessageReceived","channel":"discord","sender":"user:anon_user","content":"Check out this great deal at spamsite.example.com"}'
sleep 0.3
event "$S3" '{"type":"SkillInvoked","skill":"url-scanner","parameters":{"url":"spamsite.example.com"}}'
sleep 0.3
event "$S3" '{"type":"ToolCall","tool":"safebrowsing_check","arguments":{"url":"spamsite.example.com"}}'
sleep 0.3
event "$S3" '{"type":"ToolResult","tool":"safebrowsing_check","result":{"flagged":true,"category":"spam"},"success":true}'
sleep 0.3
event "$S3" '{"type":"PluginAction","plugin_name":"discord-mod","action":"delete_message","target":"msg:99887766"}'
sleep 0.3
event "$S3" '{"type":"MessageSent","channel":"discord","recipient":"user:anon_user","content":"Your message was removed for containing a flagged link."}'
ok "Session 3 active — 6 events (not sealed — stays live)"

# ── Session 4: Memory + multi-step reasoning ──────────────────────────────────
log "Creating session 4 — Slack scheduling assistant"
S4=$(create_session "Slack assistant — team meeting scheduler")

event "$S4" '{"type":"MessageReceived","channel":"slack","sender":"user:alice","content":"Can you schedule a team standup for tomorrow at 9am?"}'
sleep 0.2
event "$S4" '{"type":"MemoryRead","key":"user:alice:preferences","value":"{\"timezone\":\"America/New_York\",\"calendar\":\"google\"}"}'
sleep 0.2
event "$S4" '{"type":"ToolCall","tool":"calendar_create","arguments":{"title":"Team Standup","time":"2026-02-28T09:00:00-05:00","attendees":["alice","bob","carol"]}}'
sleep 0.2
event "$S4" '{"type":"ToolResult","tool":"calendar_create","result":{"event_id":"evt_abc123","link":"https://cal.example.com/evt_abc123"},"success":true}'
sleep 0.2
event "$S4" '{"type":"MemoryWrite","key":"last_scheduled_event","value":"evt_abc123"}'
sleep 0.2
event "$S4" '{"type":"MessageSent","channel":"slack","recipient":"user:alice","content":"Done! Standup scheduled for tomorrow at 9am ET. Calendar invite sent to Alice, Bob, and Carol."}'
seal "$S4"
ok "Session 4 sealed — 6 events"

# ── Done ─────────────────────────────────────────────────────────────────────
sep
echo -e "${GREEN}${BOLD}Demo data loaded!${RESET}"
sep
echo ""
echo -e "  Dashboard:  ${CYAN}${BASE}/dashboard/${RESET}"
echo -e "  API:        ${CYAN}${BASE}/api/${RESET}"
echo -e "  Sessions:   ${CYAN}${BASE}/api/sessions${RESET}"
echo -e "  Metrics:    ${CYAN}${BASE}/api/metrics${RESET}"
echo ""
echo -e "  Sessions created:"
echo -e "    S1 (sealed):  ${CYAN}${S1}${RESET}  — WhatsApp order inquiry"
echo -e "    S2 (sealed):  ${CYAN}${S2}${RESET}  — Telegram news digest"
echo -e "    S3 (active):  ${CYAN}${S3}${RESET}  — Discord moderation"
echo -e "    S4 (sealed):  ${CYAN}${S4}${RESET}  — Slack scheduler"
echo ""

# Verify chains as a sanity check
log "Verifying all chains..."
for SID in "$S1" "$S2" "$S3" "$S4"; do
  RESULT=$(get "/api/sessions/${SID}/verify")
  VERIFIED=$(json_field "$RESULT" "verified")
  if [[ "$VERIFIED" == "True" ]] || [[ "$VERIFIED" == "true" ]]; then
    ok "Chain verified: ${SID:0:8}..."
  else
    err "Chain BROKEN: ${SID:0:8}... — $RESULT"
  fi
done

echo ""
if [[ "$OWNS_SERVER" == "1" ]]; then
  warn "Server is running. Press Ctrl+C to stop."
  echo ""
  # Keep the server alive until the user interrupts
  wait "$SERVER_PID" 2>/dev/null || true
else
  ok "Done."
fi
