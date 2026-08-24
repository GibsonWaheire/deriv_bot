#!/usr/bin/env bash
# dev.sh — start everything with one command
# Usage: ./dev.sh   |   Ctrl+C to stop all

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"

log()  { echo "[dev] $*"; }
ok()   { echo "[dev] OK: $*"; }
warn() { echo "[dev] WARN: $*"; }

# ── cleanup on exit ───────────────────────────────────────────────────────────
PIDS=()
cleanup() {
  echo ""
  log "Stopping all processes..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  log "Done."
  exit 0
}
trap cleanup INT TERM

# ── kill any old backend on port 8000 ────────────────────────────────────────
OLD=$(lsof -ti :8000 2>/dev/null || true)
if [ -n "$OLD" ]; then
  log "Killing old process on :8000 (PID $OLD)..."
  kill -9 $OLD 2>/dev/null || true
  sleep 1
fi

# ── Redis ─────────────────────────────────────────────────────────────────────
if redis-cli ping &>/dev/null; then
  ok "Redis already running"
else
  log "Starting Redis..."
  redis-server --daemonize yes --logfile /tmp/redis-dst.log --port 6379
  sleep 0.5
  redis-cli ping &>/dev/null && ok "Redis started" || { warn "Redis failed"; exit 1; }
fi

# ── PostgreSQL ────────────────────────────────────────────────────────────────
if pg_ctl status -D /usr/local/var/postgresql@14 &>/dev/null; then
  ok "PostgreSQL already running"
else
  log "Starting PostgreSQL..."
  pg_ctl start -D /usr/local/var/postgresql@14 -l /tmp/pg-dst.log
  sleep 1
  ok "PostgreSQL started"
fi

# ── Backend ───────────────────────────────────────────────────────────────────
log "Starting backend on :8000..."
(
  cd "$BACKEND"
  while true; do
    .venv/bin/uvicorn main:app --reload --port 8000 --log-level warning 2>&1 \
      | while IFS= read -r line; do echo "[backend] $line"; done
    echo "[backend] restarting in 2s..."
    sleep 2
  done
) &
PIDS+=($!)

# Wait for backend to be healthy (up to 20s)
for i in $(seq 1 20); do
  if curl -sf http://localhost:8000/api/health &>/dev/null; then
    ok "Backend ready"
    break
  fi
  sleep 1
  if [ "$i" -eq 20 ]; then
    warn "Backend didn't respond after 20s — check output above"
  fi
done

# ── Frontend ──────────────────────────────────────────────────────────────────
log "Starting frontend..."
(
  cd "$FRONTEND"
  npm run dev 2>&1 | while IFS= read -r line; do echo "[frontend] $line"; done
) &
PIDS+=($!)

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "  Backend   -> http://localhost:8000"
echo "  Frontend  -> http://localhost:5174"
echo "  API docs  -> http://localhost:8000/docs"
echo ""
echo "  Press Ctrl+C to stop everything."
echo ""

wait
