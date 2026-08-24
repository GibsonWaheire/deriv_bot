#!/usr/bin/env bash
# dev.sh — start everything with one command
# Usage: ./dev.sh   |   Ctrl+C to stop all

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"

log() { echo "[dev] $*"; }

# ── cleanup on exit ───────────────────────────────────────────────────────────
PIDS=()
cleanup() {
  echo ""
  log "Stopping..."
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

# ── kill ALL old dev processes ────────────────────────────────────────────────
log "Clearing old processes..."
lsof -ti :8000 2>/dev/null | xargs kill -9 2>/dev/null || true
lsof -ti :5173 2>/dev/null | xargs kill -9 2>/dev/null || true
lsof -ti :5174 2>/dev/null | xargs kill -9 2>/dev/null || true
lsof -ti :5175 2>/dev/null | xargs kill -9 2>/dev/null || true
pkill -f "uvicorn main:app" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
sleep 1

# ── Redis ─────────────────────────────────────────────────────────────────────
if redis-cli ping &>/dev/null; then
  log "Redis: already running"
else
  log "Redis: starting..."
  redis-server --daemonize yes --logfile /tmp/redis-dst.log --port 6379
  sleep 0.5
fi

# ── PostgreSQL ────────────────────────────────────────────────────────────────
if pg_ctl status -D /usr/local/var/postgresql@14 &>/dev/null; then
  log "PostgreSQL: already running"
else
  log "PostgreSQL: starting..."
  pg_ctl start -D /usr/local/var/postgresql@14 -l /tmp/pg-dst.log -s
  sleep 1
fi

# ── Backend ───────────────────────────────────────────────────────────────────
log "Backend: starting on :8000..."
(
  cd "$BACKEND"
  while true; do
    .venv/bin/uvicorn main:app --reload --port 8000 --log-level warning 2>&1 \
      | while IFS= read -r line; do echo "[api] $line"; done
    echo "[api] restarting in 2s..."
    sleep 2
  done
) &
PIDS+=($!)

# Wait for backend to be healthy (up to 20s)
for i in $(seq 1 20); do
  if curl -sf http://localhost:8000/api/health &>/dev/null; then
    log "Backend: ready"
    break
  fi
  sleep 1
done

# ── Frontend ──────────────────────────────────────────────────────────────────
log "Frontend: starting on :5174..."
(
  cd "$FRONTEND"
  npm run dev -- --port 5174 2>&1 | while IFS= read -r line; do echo "[ui] $line"; done
) &
PIDS+=($!)

echo ""
echo "  App       -> http://localhost:5174"
echo "  API docs  -> http://localhost:8000/docs"
echo ""
echo "  Ctrl+C to stop everything."
echo ""

wait
