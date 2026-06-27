# Deriv Bot — Project TODO
> Update this file on every commit. Remove completed tasks. Add new ones as they emerge.
> Last updated: 2026-06-27

---

## Current Status
**Phase 2 complete** — Deriv OAuth2 login. Backend verifies token via Deriv WS, issues JWT. No DB needed.
**Next:** Start Phase 3 — AI analysis engine + live Deriv data pipeline + `/ws/signals`.

**Repo:** https://github.com/GibsonWaheire/deriv_bot.git
**Stack:** Vite · React · TypeScript · Tailwind CSS · FastAPI · Redis · Claude API (AI scoring)

---

## API Infrastructure (from Deriv docs)

### New Deriv API (derivws.com)
- REST base: `https://api.derivws.com`
- WebSocket authenticated: `wss://api.derivws.com/trading/v1/options/ws/{demo|real}`
- WebSocket public (no auth): `wss://api.derivws.com/trading/v1/options/ws/public`
- Auth: OAuth2 PKCE → `POST /trading/v1/options/accounts/{id}/otp` → authenticated WS URL

### Legacy WS (still works, used in prototype)
- `wss://ws.binaryws.com/websockets/v3?app_id=APP_ID`
- Used for: ticks, ticks_history, proposal, buy, sell, balance, portfolio

### Key WS Messages
- `ticks` / `ticks_history` — real-time + historical price data
- `proposal` — get live payout quote before buying (subscribable, auto-refreshes)
- `buy` — execute trade using proposal_id
- `sell` — early exit open contract
- `proposal_open_contract` — monitor live contract P&L
- `balance` — real-time balance subscription
- `transaction` — real-time trade notifications
- `portfolio` — open contracts
- `profit_table` — completed trade history
- `auto_list_strategies` — available bot strategies
- `auto_start` / `auto_pause` / `auto_resume` / `auto_stop` — automation control

### Digit Contract Types (for proposal)
- `DIGITMATCH` + `barrier: "N"` — predict exact digit 0–9
- `DIGITDIFF` + `barrier: "N"` — predict digit ≠ N
- `DIGITEVEN` — predict even digit
- `DIGITODD` — predict odd digit
- `DIGITOVER` + `barrier: "N"` — predict digit > N
- `DIGITUNDER` + `barrier: "N"` — predict digit < N

### Rate Limits
- WS: 100 req/sec, max 100 subscriptions, max 5 concurrent connections
- REST: 60 req/min per token
- Ping every 30s to keep connection alive

---

## What Was Built (Prototype — `main` branch)
- Vanilla JS: live ticks + 5000 historical ticks per symbol
- Signal engine: Digit Match (Markov), Even/Odd, Rise/Fall, Over/Under
- Signal cards, instrument cards, trade modal, trade journal (localStorage)

---

## PHASE 3 — AI Analysis Engine + Live Data Pipeline
> Goal: Python backend does all analysis. Frontend is display-only. Signals are smarter with multi-factor AI scoring.

### 3A — Deriv Client (WebSocket data layer)
- [ ] `backend/app/services/deriv_client.py`
  - [ ] Connect to `wss://ws.binaryws.com/websockets/v3?app_id=APP_ID`
  - [ ] `fetch_tick_history(symbol, count)` → list of prices + times
  - [ ] `subscribe_ticks(symbol, on_tick)` — live tick callback
  - [ ] `get_proposal(symbol, contract_type, barrier, stake, token)` → payout quote
  - [ ] `execute_buy(proposal_id, price, token)` → contract_id
  - [ ] `subscribe_balance(token, on_balance)` — real-time balance stream
  - [ ] `subscribe_transaction(token, on_tx)` — real-time trade notifications
  - [ ] Ping loop (every 25s), exponential backoff reconnect
  - [ ] `forget_all()` cleanup on disconnect

### 3B — AI Signal Scoring Engine
- [ ] `backend/app/services/analysis.py`
  - [ ] `build_transition_matrix(digits)` → 10×10 Markov matrix
  - [ ] `score_digit_match(digits)` → per-digit: markov_prob, frequency_deficit, gap_score, composite_score
  - [ ] `score_even_odd(digits)` → pEven, pOdd, streak_length, momentum_bias
  - [ ] `score_rise_fall(prices)` → pRise, pFall, streak_reversal_prob, volatility_regime
  - [ ] `score_over_under(digits)` → best_threshold, prob per threshold 1–8
  - [ ] `detect_pattern_runs(digits)` → identify repeating patterns, anti-patterns
  - [ ] `score_momentum(prices, window=20)` → directional momentum strength
  - [ ] `extract_signals(symbol, digits, prices)` → ranked Signal list with composite AI score
  - [ ] Signal grading: A (≥65%), B (55–64%), C (50–54%) — only show A+B
  - [ ] `get_live_proposal(signal, token)` — enrich signal with real Deriv payout before surfacing

### 3C — AI Score Explainability (Claude API)
- [ ] `backend/app/services/ai_explainer.py`
  - [ ] `explain_signal(signal_data)` → calls Claude API
  - [ ] Input: digit frequencies, transition matrix slice, streak, gap, momentum
  - [ ] Output: 2-sentence plain English explanation shown on signal card
  - [ ] Cache explanations for 30s (Redis) to avoid repeat calls on same signal
  - [ ] Model: `claude-haiku-4-5` (fast + cheap for real-time use)

### 3D — WebSocket Signal Broadcaster
- [ ] `backend/app/core/ws_manager.py`
  - [ ] Per-user WS connection pool to Deriv (keyed by deriv_account_id)
  - [ ] `SignalBroadcaster` — runs analysis every tick, pushes results to all connected frontend clients
  - [ ] `/ws/signals` FastAPI WS endpoint — frontend subscribes here
  - [ ] Message types: `{ type: "signal", data: Signal[] }`, `{ type: "tick", data: {...} }`, `{ type: "balance", data: {...} }`
  - [ ] Heartbeat ping every 25s on both Deriv WS and frontend WS

### 3E — Tests
- [ ] `pytest` unit tests for all analysis functions
- [ ] Assert: transition matrix rows sum to 1.0 ±0.001
- [ ] Assert: signals sorted by composite score descending
- [ ] Assert: grade thresholds correct

- [ ] Commit: `feat: phase 3 - ai analysis engine + live data pipeline`

---

## PHASE 4 — React Dashboard UI (Full Rebuild)
> Goal: React frontend fully wired to FastAPI. Real-time signals. One-click trade execution.

### 4A — Pages
- [ ] `/` — Landing page: headline, live signal preview (anonymised), feature grid, affiliate CTA, login button
- [ ] `/dashboard` — Signal terminal (protected): signal tray + instrument cards + trade modal
- [ ] `/journal` — Real P&L from Deriv `profit_table` + local session log + win rate chart
- [ ] `/settings` — Instruments, stake amount, risk limits, notification preferences
- [ ] `/auto` — Automation control panel (start/pause/stop bot runs)

### 4B — Core Components
- [ ] `<SignalTray />` — horizontal scrollable cards, live via `/ws/signals`, sorted by AI score
- [ ] `<SignalCard />` — strategy badge, instrument name, probability gauge, AI explanation, live payout, TRADE button
- [ ] `<InstrumentCard />` — digit strip (last 20), strategy grid, over/under heatmap, sparkline
- [ ] `<TradeModal />` — live proposal (real payout from Deriv), click timing, RTT, estimated entry tick, WIN/LOSS/SKIP logger
- [ ] `<LiveBalance />` — real-time balance from Deriv WS balance subscription
- [ ] `<JournalTable />` — paginated trade log from `profit_table` API
- [ ] `<WinRateChart />` — recharts area chart, actual win % over last 100 trades
- [ ] `<AutoPanel />` — list available strategies, configure stake/limits, start/pause/stop automation
- [ ] `<Topbar />` — RTT, live balance, win rate, trade count, status dot

### 4C — Hooks
- [ ] `useSignals(symbols)` — WS connection to `/ws/signals`, parses signal + tick + balance messages
- [ ] `useProposal(signal)` — calls Deriv proposal WS, returns live payout before trade
- [ ] `useJournal()` — fetches `profit_table` from backend, merges with session log
- [ ] `useBalance()` — subscribes to live balance via backend WS relay
- [ ] `useAuth()` — current user, token, logout

### 4D — One-Click Trade Execution
- [ ] Signal card TRADE button → open TradeModal
- [ ] TradeModal fetches live proposal (real payout) via `useProposal`
- [ ] User sees: stake → payout, contract type, estimated entry tick
- [ ] "Place Trade" → `POST /api/trade/buy` → backend calls Deriv `buy`
- [ ] After contract opens: subscribe to `proposal_open_contract` for live P&L
- [ ] WIN/LOSS auto-detected when contract closes (via transaction subscription)
- [ ] Journal updated automatically

- [ ] Commit: `feat: phase 4 - react dashboard ui + trade execution`

---

## PHASE 5 — Automation Bot
> Goal: User turns on the bot, it trades automatically based on AI signals. Full control panel.

- [ ] `POST /api/auto/start` — user configures: symbols, stake, max_trades_per_hour, min_grade (A/B), max_daily_loss
- [ ] `POST /api/auto/pause` / `POST /api/auto/resume` / `POST /api/auto/stop`
- [ ] `GET /api/auto/status` — current run stats: trades placed, P&L, current signal
- [ ] Backend automation loop:
  - [ ] Wait for Grade A signal from analysis engine
  - [ ] Fetch live proposal to confirm payout ≥ minimum threshold
  - [ ] Execute buy via Deriv WS
  - [ ] Monitor contract via `proposal_open_contract`
  - [ ] Log outcome, update session P&L
  - [ ] Apply Martingale or flat-stake strategy based on user setting
  - [ ] Stop if daily loss limit hit
- [ ] Use Deriv's `auto_list_strategies` to check if built-in strategies complement ours
- [ ] `/auto` page on frontend: live trade feed, P&L meter, stop button
- [ ] Safety: never auto-trade without explicit user activation per session
- [ ] Commit: `feat: phase 5 - automation bot`

---

## PHASE 6 — Affiliate Tracking + DB
> Goal: Track referred users for commission. First time we need a database.

- [ ] Docker: PostgreSQL via docker-compose (already in place)
- [ ] SQLAlchemy models: `ReferredUser(deriv_acct_id, referred_at, first_trade_at, is_active)`
- [ ] Alembic migration: `alembic revision --autogenerate -m "create referred_users"`
- [ ] Landing page signup link → `https://track.deriv.com/AFFILIATE_ID/1/` (set in .env)
- [ ] `POST /api/affiliate/register` — called from AuthCallback when user has referral param
- [ ] Track first trade via `transaction` subscription on user's WS session
- [ ] `GET /api/affiliate/stats` → referred count, active traders, estimated commission
- [ ] Admin page `/admin/affiliate` — summary table
- [ ] Commit: `feat: phase 6 - affiliate tracking`

---

## PHASE 7 — Subscriptions
> Goal: Monetize with tiers. Free users get signals. Pro users get one-click trade. Elite get full bot.

- [ ] Stripe account + webhook endpoint `/api/webhooks/stripe`
- [ ] `Subscription` model: deriv_acct_id, tier (free/pro/elite), stripe_sub_id, expires_at
- [ ] Tier gates:
  - Free: signals dashboard, manual journal
  - Pro ($19/mo): one-click trade execution, live proposals, full journal
  - Elite ($49/mo): full automation bot, custom risk settings, priority signals
- [ ] Pricing page on landing (before login)
- [ ] Stripe Checkout session → `POST /api/subscriptions/checkout`
- [ ] Webhook: `customer.subscription.updated` → update DB
- [ ] Tier middleware on protected routes
- [ ] Commit: `feat: phase 7 - subscriptions`

---

## PHASE 8 — Notifications
> Goal: Alert users when strong signal fires, even when browser is closed.

- [ ] Telegram bot — instant push when Grade A signal + payout ≥ threshold
- [ ] Email (SendGrid) — daily P&L digest, "bot stopped: loss limit hit" alerts
- [ ] Browser Push (Web Push API) — permission prompt in settings
- [ ] User preferences: per-strategy notification toggle, min confidence threshold
- [ ] Commit: `feat: phase 8 - notifications`

---

## PHASE 9 — Production Deploy
> Goal: Live, monitored, auto-deploying.

- [ ] `Dockerfile` for backend (multi-stage, slim Python image)
- [ ] GitHub Actions CI: lint → pytest → tsc → vite build on every PR
- [ ] GitHub Actions CD: deploy on merge to `main`
- [ ] Frontend → Vercel (connect GitHub, auto-deploy `frontend/`)
- [ ] Backend → Railway or Render (Dockerfile)
- [ ] Database → Supabase (managed PostgreSQL) — only needed from Phase 6
- [ ] Redis → Upstash (serverless Redis, signal cache + session)
- [ ] Custom domain + SSL
- [ ] Sentry error tracking (frontend + backend)
- [ ] Uptime Robot monitoring
- [ ] Commit: `feat: phase 9 - production deploy`

---

## Backlog / Future Ideas
- MCP integration: connect `https://mcp-api.deriv.com/mcp` for AI tools to query live Deriv data
- Bulk purchase: same signal → buy across multiple Deriv accounts simultaneously
- Accumulator strategy: detect low volatility periods → auto-enter ACCU contracts
- Multiplier strategy: strong directional signal → MULTUP/MULTDOWN with stop-loss
- Signal accuracy tracking: log every signal, record outcome, compute true accuracy over time
- Leaderboard: top performing users (opt-in, anonymised)
- Mobile PWA: install-to-homescreen, push notifications
- Multi-language support
