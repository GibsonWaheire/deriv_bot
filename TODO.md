# Digit Strategy Terminal — TODO
> Update this file on every commit. Remove completed tasks. Add new ones as they emerge.
> Last updated: 2026-06-27

---

## Core Vision
**A self-contained trading terminal.** The user never needs to open Deriv.
- The app fetches live tick data from Deriv in real time
- AI analyzes thousands of historical ticks per symbol every tick
- When confidence is high enough, a signal fires: "Digit 3, Match, 5 ticks — 71% confidence"
- User clicks TRADE — the app sends the order directly to Deriv via API, accounting for server RTT
- AI can also run fully autonomously: detect signal → time the entry → place the trade → log outcome
- Everything — analysis, execution, journal, P&L — is inside this app

---

## Current Status
**Phase 2 complete** — Deriv OAuth2 login (token verified via WS, JWT issued). Dev bypass live.
**Next:** Phase 3 — AI signal engine with timing-aware trade execution.

**Repo:** https://github.com/GibsonWaheire/deriv_bot.git
**Stack:** Vite · React · TypeScript · Tailwind · FastAPI · Redis · Claude API

---

## API Reference (Deriv)

### WebSocket (primary channel)
- Legacy WS: `wss://ws.binaryws.com/websockets/v3?app_id=APP_ID`
- New WS: `wss://api.derivws.com/trading/v1/options/ws/{demo|real}` (OTP authenticated)
- Public WS (no auth): `wss://api.derivws.com/trading/v1/options/ws/public`

### Key WS Messages
- `ticks` + `ticks_history` — live feed + 5000 historical prices per symbol
- `proposal` (subscribable) — real payout quote: stake → payout, updates each tick
- `buy` — place the trade using a proposal_id
- `proposal_open_contract` — track live contract P&L tick by tick
- `transaction` — fires when contract settles (WIN/LOSS detected automatically)
- `balance` — real-time account balance
- `profit_table` — full trade history from Deriv (no localStorage needed)
- `auto_start` / `auto_pause` / `auto_resume` / `auto_stop` — Deriv's automation API

### Digit Contract Types (used in `proposal`)
- `DIGITMATCH` + `barrier: "N"` — last digit = N (1–5 tick duration)
- `DIGITDIFF` + `barrier: "N"` — last digit ≠ N
- `DIGITEVEN` — last digit is even
- `DIGITODD` — last digit is odd
- `DIGITOVER` + `barrier: "N"` — last digit > N
- `DIGITUNDER` + `barrier: "N"` — last digit < N

### Rate Limits
- WS: 100 req/sec, max 100 subscriptions, max 5 concurrent connections per user
- REST: 60 req/min per token — Ping every 25s to keep connection alive

---

## PHASE 3 — AI Signal Engine + Timing-Aware Execution
> Goal: Backend does all analysis. Fires a signal only when confidence clears threshold.
> Signal includes: digit, strategy, tick duration, entry timing, confidence score.

### 3A — Live Data Client
- [ ] `backend/app/services/deriv_client.py`
  - [ ] Connect to Deriv WS, authenticate with user token
  - [ ] `fetch_tick_history(symbol, count=5000)` → prices[], times[]
  - [ ] `subscribe_ticks(symbol, callback)` — fires on every new tick
  - [ ] `get_proposal(symbol, contract_type, barrier, duration, stake, token)` → proposal_id, payout, ask_price
  - [ ] `execute_buy(proposal_id, price, token)` → contract_id
  - [ ] `subscribe_open_contract(contract_id, callback)` — live P&L per tick
  - [ ] `subscribe_balance(token, callback)` — real-time balance updates
  - [ ] `subscribe_transaction(token, callback)` — auto WIN/LOSS detection on contract close
  - [ ] RTT measurement: send `time` ping before every trade, record latency
  - [ ] Reconnect with exponential backoff (1s → 2s → 4s → max 30s)
  - [ ] `forget_all()` cleanup on disconnect

### 3B — Analysis Engine
- [ ] `backend/app/services/analysis.py`
  - [ ] `build_transition_matrix(digits)` → 10×10 Markov matrix (row=current, col=next)
  - [ ] `score_digit_match(digits)` → per digit 0–9:
    - markov probability (from transition matrix, last 3 digits of chain)
    - frequency deficit (how far below 10% baseline)
    - gap score (ticks since this digit last appeared — higher gap = stronger signal)
    - composite score = weighted average of above three
  - [ ] `score_even_odd(digits)` → pEven, pOdd, current streak length, momentum direction
  - [ ] `score_rise_fall(prices)` → pRise, pFall, streak reversal probability, volatility regime
  - [ ] `score_over_under(digits)` → best threshold 1–8, probability per threshold
  - [ ] `detect_momentum(prices, window=20)` → directional bias, strength 0–1
  - [ ] `detect_volatility_regime(prices)` → low/medium/high — affects tick duration recommendation
  - [ ] `recommend_duration(symbol, strategy, volatility)` → 1, 2, or 5 ticks
    - low vol + digit match → 1 tick (faster settlement, less drift)
    - high vol + rise/fall → 5 ticks (momentum has time to play out)
  - [ ] `extract_signals(symbol, digits, prices)` → list of Signal, sorted by composite score
    - Only emit if composite score ≥ 55% (configurable threshold)
    - Each signal includes: symbol, strategy, digit/barrier, recommended_duration, confidence, edge, grade (A/B/C)

### 3C — Timing Engine (the key differentiator)
> When to fire the order so the trade enters at exactly the right tick.
- [ ] `backend/app/services/timing.py`
  - [ ] `measure_rtt(ws)` → current round-trip time to Deriv WS in ms
  - [ ] `estimate_tick_interval(symbol, recent_times[])` → avg ms between ticks (e.g. ~1000ms for Vol indices, ~250ms for 1s indices)
  - [ ] `compute_entry_deadline(tick_interval, rtt)` → how many ms after current tick we have to send the order and still enter on the NEXT tick
    - Formula: `deadline = tick_interval - rtt - 50ms_buffer`
  - [ ] `should_fire_now(last_tick_time, rtt, tick_interval)` → bool
    - True if we're within the entry window for the next tick
    - Prevents entering mid-tick (which would waste a tick)
  - [ ] `schedule_entry(signal, ws, token)` → waits for optimal moment, then calls `execute_buy`
  - [ ] Expose timing info to frontend: `{ rtt_ms, tick_interval_ms, entry_window_ms, next_tick_in_ms }`

### 3D — Claude API Signal Explainer
- [ ] `backend/app/services/ai_explainer.py`
  - [ ] `explain_signal(signal)` → calls `claude-haiku-4-5`, returns 2-sentence explanation
  - [ ] Input: transition matrix slice, digit frequencies, gap, streak, recommended duration
  - [ ] Example output: "Digit 3 has appeared only 3 times in the last 100 ticks vs an expected 10. The Markov chain shows a 68% transition probability from the current sequence to digit 3 in the next 2 ticks."
  - [ ] Cache in Redis for 30s (same signal = same explanation, no repeat API calls)
  - [ ] Fallback: if Claude unavailable, show raw stats instead

### 3E — WebSocket Signal Broadcaster
- [ ] `backend/app/core/ws_manager.py`
  - [ ] Per-user Deriv WS connection (keyed by JWT sub)
  - [ ] On every tick: run `extract_signals()` → if Grade A/B signal found → broadcast to frontend
  - [ ] FastAPI `/ws/signals` endpoint — frontend subscribes here
  - [ ] Message types pushed to frontend:
    - `{ type: "signal", data: Signal[] }` — new signals ranked by confidence
    - `{ type: "tick", symbol, digit, price, epoch }` — every tick for live digit strip
    - `{ type: "balance", balance, currency }` — real-time balance
    - `{ type: "trade_update", contract_id, pnl, status }` — open contract P&L
    - `{ type: "trade_settled", contract_id, outcome, pnl }` — WIN/LOSS auto-detected
    - `{ type: "timing", rtt_ms, tick_interval_ms, next_tick_in_ms }` — entry timing data
  - [ ] Heartbeat: ping Deriv every 25s, ping frontend client every 15s

### 3F — Trade Execution API
- [ ] `backend/app/api/trade.py`
  - [ ] `POST /api/trade/proposal` — get live quote (proposal_id, payout) for a signal
    - Body: `{ symbol, contract_type, barrier, duration, stake }`
    - Returns: `{ proposal_id, ask_price, payout, payout_percentage }`
  - [ ] `POST /api/trade/buy` — execute trade with timing engine
    - Body: `{ proposal_id, price, symbol }` (user's JWT provides the Deriv token)
    - Backend: calls `schedule_entry()` → fires at optimal tick window → returns contract_id
  - [ ] `POST /api/trade/sell` — early exit open contract
    - Body: `{ contract_id }`
  - [ ] `GET /api/trade/history` — fetch `profit_table` from Deriv (no local DB needed)
  - [ ] `GET /api/trade/open` — fetch `portfolio` (open contracts)
  - [ ] All endpoints: protected by JWT `Depends(get_current_user)`, Deriv token extracted from JWT

### 3G — Tests
- [ ] pytest: transition matrix rows sum to 1.0 ± 0.001
- [ ] pytest: signals sorted by composite score descending
- [ ] pytest: grade thresholds — A ≥ 65%, B 55–64%, C < 55% (filtered out)
- [ ] pytest: timing engine — deadline always > 0 when RTT < tick_interval
- [ ] Commit: `feat: phase 3 - ai signal engine + timing-aware execution`

---

## PHASE 4 — Full Dashboard UI
> Goal: The complete trading terminal. User never needs to open Deriv.
> Every action — analysis, signal review, trade, journal — is inside this app.

### 4A — Pages
- [ ] `/dashboard` — live signal terminal + instrument cards + trade modal (main view)
- [ ] `/journal` — real P&L from Deriv `profit_table`, session stats, win rate chart
- [ ] `/auto` — automation control (start/pause/stop AI bot, configure risk limits)
- [ ] `/settings` — instruments, default stake, min confidence threshold, notification prefs
- [ ] `/` — landing page: live anonymised signal preview, features, affiliate CTA, login

### 4B — Signal Display
- [ ] `<SignalTray />` — horizontal scrollable signal cards, live from `/ws/signals`
  - Sorted by confidence score, Grade A first
  - Each card pulses when signal is fresh (< 3 ticks old)
  - Stale signals (> 10 ticks) fade out automatically
- [ ] `<SignalCard />` — shows:
  - Strategy badge (MATCH / EVEN / ODD / RISE / FALL / OVER / UNDER)
  - Instrument name ("Volatility 100")
  - Target digit (for digit strategies) highlighted large
  - Confidence % + grade badge (A/B)
  - Recommended duration ("Enter for 2 ticks")
  - AI explanation (2 sentences from Claude)
  - Live payout (fetched from Deriv proposal, updates each tick)
  - Entry timing bar: countdown to optimal entry window
  - **TRADE** button — triggers `POST /api/trade/proposal` then opens TradeModal

### 4C — Trade Execution
- [ ] `<TradeModal />` — opens when user clicks TRADE on a signal card
  - Shows: digit, strategy, confidence, recommended duration
  - Live payout from Deriv (updates every tick via `useProposal` hook)
  - Stake input with quick-select buttons ($1 / $5 / $10 / custom)
  - Entry timing display: "Next entry window in 340ms" (live countdown)
  - RTT display: "Server RTT: 42ms"
  - **Place Trade** button:
    - Calls `POST /api/trade/buy`
    - Backend timing engine fires at optimal tick window
    - Modal transitions to "Waiting for entry…" then "Contract open"
  - After entry: live P&L ticker (from `proposal_open_contract` subscription)
  - Auto-closes and logs outcome when contract settles (WIN/LOSS from transaction subscription)
  - No manual WIN/LOSS entry needed — Deriv tells us the outcome
- [ ] `<LiveBalance />` in topbar — real-time balance from balance subscription

### 4D — Instrument View
- [ ] `<InstrumentCard />` — per symbol:
  - Last 20 digits displayed as coloured cells (each digit has a colour)
  - Current tick price + pip
  - Strategy breakdown grid (each strategy's current confidence %)
  - Over/Under heatmap (thresholds 1–8, colour-coded probability)
  - Sparkline (last 50 price movements)
  - Tick interval + RTT displayed live

### 4E — Journal (Real Data)
- [ ] `<JournalTable />` — paginated table from Deriv `profit_table`
  - Columns: time, symbol, strategy, digit, duration, stake, payout, outcome, P&L
  - Filter by symbol, strategy, outcome
- [ ] `<WinRateChart />` — recharts area chart, win % rolling over last 50 / 100 / 200 trades
- [ ] `<SessionSummary />` — current session: trades placed, win rate, net P&L, best signal

### 4F — Hooks
- [ ] `useSignals(symbols)` — subscribes to `/ws/signals`, exposes signals[], ticks[], balance
- [ ] `useProposal(signal, stake)` — live payout quote from Deriv, auto-refreshes each tick
- [ ] `useTradeExecution()` — wraps `POST /api/trade/buy`, tracks pending/open/settled state
- [ ] `useJournal()` — fetches profit_table, merges with in-session trades
- [ ] `useBalance()` — live balance from WS
- [ ] `useTiming(symbol)` — RTT, tick interval, entry window countdown

- [ ] Commit: `feat: phase 4 - full trading terminal ui`

---

## PHASE 5 — AI Automation Bot
> Goal: AI runs the full loop autonomously. User sets risk limits and walks away.

- [ ] `backend/app/services/bot.py`
  - [ ] `BotSession` — per-user: active symbols, stake, min_grade, max_trades_per_hour, max_daily_loss_pct, strategy (flat/martingale)
  - [ ] Loop: wait for Grade A signal → fetch proposal → confirm payout ≥ 80% → schedule_entry → buy → monitor → log
  - [ ] Martingale mode: double stake after loss (up to 4x), reset on win
  - [ ] Hard stops: pause if daily loss > user limit, pause if 3 consecutive losses
  - [ ] Resume only on explicit user action (never auto-resume from loss stop)
- [ ] `backend/app/api/bot.py`
  - [ ] `POST /api/bot/start` — starts BotSession with config
  - [ ] `POST /api/bot/pause` / `/resume` / `/stop`
  - [ ] `GET /api/bot/status` — live stats: trades, win rate, P&L, current signal being watched
- [ ] Frontend `/auto` page:
  - [ ] Configure: symbols, stake, min confidence, max daily loss, strategy
  - [ ] Live feed of bot decisions: "Watching Vol 100 for Digit 3 MATCH…", "Trade placed: contract #123"
  - [ ] P&L meter (green/red progress bar vs daily limit)
  - [ ] Pause / Stop buttons always visible
  - [ ] Bot cannot start unless user explicitly clicks START this session (no auto-start on login)
- [ ] Commit: `feat: phase 5 - ai automation bot`

---

## PHASE 6 — Affiliate Tracking + DB
> First time a database is actually needed.

- [ ] PostgreSQL via docker-compose (already scaffolded)
- [ ] SQLAlchemy model: `ReferredUser(deriv_acct_id, referred_at, first_trade_at, is_active)`
- [ ] Alembic migration: `alembic revision --autogenerate -m "create referred_users"`
- [ ] Affiliate link on landing: `https://track.deriv.com/AFFILIATE_ID/1/` (from .env)
- [ ] `POST /api/affiliate/register` — called from AuthCallback when referral param present
- [ ] First trade tracking via `transaction` subscription (already subscribed per user)
- [ ] `GET /api/affiliate/stats` — count, active traders, estimated commission
- [ ] Admin page `/admin/affiliate`
- [ ] Commit: `feat: phase 6 - affiliate tracking`

---

## PHASE 7 — Subscriptions
> Gate features by tier. Free gets signals. Pro gets one-click trade. Elite gets full bot.

- [ ] Stripe setup + `POST /api/webhooks/stripe`
- [ ] `Subscription` model: deriv_acct_id, tier, stripe_sub_id, expires_at
- [ ] Tier gates:
  - **Free** — live signals dashboard, read-only journal
  - **Pro ($19/mo)** — one-click trade execution, live proposals, full journal
  - **Elite ($49/mo)** — full AI automation bot, custom risk settings, priority signals
- [ ] Pricing page on landing (visible before login)
- [ ] Stripe Checkout → `POST /api/subscriptions/checkout`
- [ ] Webhook: `customer.subscription.updated` → update DB tier
- [ ] Commit: `feat: phase 7 - subscriptions`

---

## PHASE 8 — Notifications
- [ ] Telegram bot: Grade A signal fires → instant message with digit, confidence, payout
- [ ] Email (SendGrid): daily P&L digest, "bot stopped: loss limit hit" alert
- [ ] Browser Push: permission prompt in /settings, fires on Grade A signal
- [ ] User preference: per-strategy toggle, min confidence threshold for alerts
- [ ] Commit: `feat: phase 8 - notifications`

---

## PHASE 9 — Production Deploy
- [ ] `Dockerfile` for backend (multi-stage, slim Python image)
- [ ] GitHub Actions CI: pytest → tsc → vite build on every PR
- [ ] GitHub Actions CD: deploy on merge to main
- [ ] Frontend → Vercel (auto-deploy `frontend/`)
- [ ] Backend → Railway or Render (Dockerfile)
- [ ] DB → Supabase (only needed from Phase 6)
- [ ] Redis → Upstash (signal cache + session state)
- [ ] Custom domain + SSL + Sentry + Uptime Robot
- [ ] Commit: `feat: phase 9 - production deploy`

---

## Backlog / Future
- MCP integration: `https://mcp-api.deriv.com/mcp` — AI tools query live Deriv data directly
- Bulk purchase: same signal → trade across multiple accounts simultaneously
- Accumulator strategy: low volatility regime → auto-enter ACCU contracts
- Multiplier strategy: strong directional signal → MULTUP/MULTDOWN with stop-loss
- Signal accuracy tracker: log every signal recommendation, compare to actual outcome, compute true edge
- Leaderboard: top performing users (opt-in, anonymised)
- Mobile PWA: install to homescreen, push notifications
