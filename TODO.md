# Digit Strategy Terminal — TODO
> Update this file on every commit. Remove completed tasks. Add new ones as they emerge.
> Last updated: 2026-06-27

---

## Core Vision
**A self-contained trading terminal. User never opens Deriv.**
- App fetches live tick data from Deriv in real time
- AI analyzes thousands of historical ticks every tick
- When confidence clears threshold a signal fires: "Digit 3 · MATCH · 2 ticks · 71%"
- User clicks TRADE — backend times the entry to the exact tick, fires order to Deriv via API
- AI auto-mode: detect signal → time entry → place trade → log outcome — fully autonomous
- Everything inside this app: analysis, execution, journal, P&L, balance

---

## Current Status
**Phase 3 complete** — AI signal engine, Deriv WS client, timing engine, Claude AI explainer, WebSocket broadcaster, and Trade API all built and tested (36/36 tests pass).
**Next:** Phase 4 — Full Dashboard UI (signal tray, trade modal, instrument cards, journal, live balance).

**Repo:** https://github.com/GibsonWaheire/deriv_bot.git
**Stack:** Vite · React · TypeScript · Tailwind · FastAPI · Redis · Claude API

---

## Full Deriv API Reference (from llms.txt — confirmed)

### OAuth2 PKCE Flow (NEW — required for new API)
```
1. Generate: code_verifier (random 43-128 chars), code_challenge = BASE64URL(SHA256(verifier)), state (CSRF)
2. Store in sessionStorage: pkce_code_verifier, oauth_state
3. Redirect user → https://auth.deriv.com/oauth2/auth?
       response_type=code
       &client_id=YOUR_CLIENT_ID        ← from Deriv dashboard (different from APP_ID)
       &redirect_uri=https://yourapp.com/auth/callback
       &scope=trade
       &state=RANDOM_STATE
       &code_challenge=PKCE_CHALLENGE
       &code_challenge_method=S256
4. Callback receives: ?code=AUTH_CODE&state=STATE
5. Backend exchanges: POST https://auth.deriv.com/oauth2/token
       grant_type=authorization_code
       &client_id=YOUR_CLIENT_ID
       &code=AUTH_CODE
       &code_verifier=ORIGINAL_VERIFIER
       &redirect_uri=https://yourapp.com/auth/callback
   → returns: { access_token: "ory_at_...", expires_in: 3600 }
6. REST: GET https://api.derivws.com/trading/v1/options/accounts
       Authorization: Bearer access_token
       Deriv-App-ID: YOUR_APP_ID
   → get account_id (e.g. "DOT90004580" demo, "CR90004580" real)
7. REST: POST https://api.derivws.com/trading/v1/options/accounts/{account_id}/otp
       Authorization: Bearer access_token
       Deriv-App-ID: YOUR_APP_ID
   → returns: { data: { url: "wss://api.derivws.com/trading/v1/options/ws/demo?otp=abc123" } }
8. Connect WebSocket: new WebSocket(otpData.url)  ← already authenticated, NO authorize step
```

### Sign Up URL (affiliate tracking built-in)
```
https://auth.deriv.com/oauth2/auth?
  response_type=code
  &client_id=YOUR_CLIENT_ID
  &redirect_uri=https://yourapp.com/auth/callback
  &scope=trade
  &state=STATE
  &code_challenge=CHALLENGE
  &code_challenge_method=S256
  &prompt=registration           ← shows signup form instead of login
  &sidc=YOUR_SESSION_GUID        ← from Deriv partner dashboard
  &utm_campaign=YOUR_CAMPAIGN
  &utm_medium=affiliate
  &utm_source=YOUR_AFFILIATE_ID  ← e.g. CU303219
```

### WebSocket Endpoints (29 total — all confirmed with exact request/response)

#### Account (auth required)
- `balance` — `{ balance:1, subscribe:1 }` → `{ balance: { balance:10092, currency:"USD", loginid:"VRTC..." } }`
- `portfolio` — `{ portfolio:1 }` → open contracts list
- `profit_table` — `{ profit_table:1, limit:25, offset:0, description:1 }` → completed trade history
- `statement` — `{ statement:1, limit:100 }` → full transaction history
- `transaction` — `{ transaction:1, subscribe:1 }` → real-time trade notifications (WIN/LOSS detected here)

#### Market Data (no auth)
- `active_symbols` — `{ active_symbols:"brief" }` → all tradeable symbols with pip_size
- `contracts_for` — `{ contracts_for:"1HZ100V" }` → available contract types per symbol
- `ticks` — `{ ticks:"1HZ100V", subscribe:1 }` → `{ tick: { ask, bid, epoch, pip_size, quote, symbol } }`
- `ticks_history` — `{ ticks_history:"1HZ100V", end:"latest", count:5000, style:"ticks" }` → prices[], times[]
  - `style:"candles"` + `granularity:60` → OHLC candles (60s, 120, 180, 300, 600, 900, 1800, 3600, 7200, 14400, 28800, 86400)

#### Trading (auth required)
- `proposal` — get payout quote:
  ```json
  { "proposal":1, "amount":10, "basis":"stake", "contract_type":"DIGITMATCH",
    "currency":"USD", "duration":5, "duration_unit":"t",
    "underlying_symbol":"1HZ100V", "barrier":"3", "subscribe":1 }
  ```
  Response: `{ proposal: { id:"abc123", ask_price:10.50, payout:19.90, spot:5123.44, longcode:"..." } }`
  - `id` is the proposal_id → pass to `buy`
  - `subscribe:1` → quote updates every tick automatically
  - supports `limit_order: { stop_loss, take_profit }` for MULTUP/MULTDOWN/ACCU

- `buy` — execute trade:
  ```json
  { "buy":"abc123", "price":10.50, "subscribe":1 }
  ```
  Response: `{ buy: { balance_after, buy_price, contract_id, payout, purchase_time, transaction_id } }`
  - `subscribe:1` → automatically streams `proposal_open_contract` updates after purchase

- `sell` — early exit: `{ "sell":12345678, "price":0 }` (price:0 = sell at market)
- `proposal_open_contract` — monitor live P&L: `{ proposal_open_contract:1, contract_id:123, subscribe:1 }`
- `contract_update` — set stop_loss/take_profit: `{ contract_update:1, contract_id:123, limit_order:{ stop_loss:5, take_profit:15 } }`
- `cancel` — cancel contract (if cancellation available): `{ cancel:12345678 }`

#### Automation (auth required, scope: trade)
- `auto_list_strategies` — `{ auto_list_strategies:1 }` → list built-in strategies (no auth needed)
- `auto_start`:
  ```json
  { "auto_start":1, "contract_template":{ "contract_type":"CALL", "currency":"USD",
    "underlying_symbol":"R_100", "duration":5, "duration_unit":"t", "amount":10 },
    "strategy_id":"martingale", "strategy_parameters":{}, "subscribe":1 }
  ```
- `auto_get` — `{ auto_get:1, run_id:"run_123", subscribe:1 }` → live run stats
- `auto_list` — `{ auto_list:1 }` → all runs for account
- `auto_pause` / `auto_resume` / `auto_stop` — `{ auto_pause:1, run_id:"run_123" }`

#### Subscriptions
- `forget` — `{ forget:"subscription_id" }` — cancel one subscription
- `forget_all` — `{ forget_all:["ticks","proposal"] }` — cancel all of a type

#### System (no auth)
- `ping` — `{ ping:1 }` → `{ ping:"pong" }`
- `time` — `{ time:1 }` → `{ time:1234567890 }` (use for RTT measurement)
- `trading_times` — `{ trading_times:"today" }` → market hours

### REST Endpoints (base: https://api.derivws.com)
All REST calls need `Deriv-App-ID: YOUR_APP_ID` header + `Authorization: Bearer oauth_token`

- `GET /trading/v1/options/accounts` → list accounts (get account_id for OTP step)
- `POST /trading/v1/options/accounts` → create demo/real account (currency:USD, group:row)
- `POST /trading/v1/options/accounts/{id}/reset-demo-balance` → reset demo to $10,000
- `POST /trading/v1/options/accounts/{id}/otp` → get authenticated WS URL ← critical step
- `GET /v1/health` → service health check
- `GET /applications/v1/markup-statistics?date_from=&date_to=` → app markup revenue (track earnings)
- `POST /trading/v1/options/contracts/bulk-purchase/real` → same trade across up to 100 real accounts
- `POST /trading/v1/options/contracts/bulk-purchase/demo` → same, demo accounts

### Contract Types (confirmed)
| Type | Strategy | Win condition |
|---|---|---|
| DIGITMATCH | Digit | Last digit = barrier (0–9) |
| DIGITDIFF | Digit | Last digit ≠ barrier |
| DIGITEVEN | Digit | Last digit is even |
| DIGITODD | Digit | Last digit is odd |
| DIGITOVER | Digit | Last digit > barrier |
| DIGITUNDER | Digit | Last digit < barrier |
| CALL | Rise/Fall | Exit spot > entry spot |
| PUT | Rise/Fall | Exit spot < entry spot |
| HIGHER | Touch | Spot > barrier |
| LOWER | Touch | Spot < barrier |
| MULTUP | Multiplier | Up with multiplier + SL/TP |
| MULTDOWN | Multiplier | Down with multiplier + SL/TP |
| ACCU | Accumulator | Stays in range, compounds |

Duration unit: `"t"` = ticks (1–5 for digits), `"s"` = seconds, `"m"` = minutes

### Error Codes
`AuthorizationRequired`, `InvalidToken`, `RateLimit`, `InputValidationFailed`,
`ContractNotFound`, `InsufficientBalance`, `ValidationError`, `InternalError`

### Rate Limits
- WS: 100 req/sec, max 100 subscriptions, max 5 concurrent connections
- REST: 60 req/min per token
- Ping every 30s to keep WS alive

---

## What Was Built (Prototype)
- Vanilla JS: live ticks + 5000 historical ticks, Markov signals, signal cards, trade journal (localStorage)
- Signal engine: DIGITMATCH (Markov), Even/Odd, Rise/Fall, Over/Under

---

## PHASE 2B — COMPLETE ✓
- PKCE: `src/lib/pkce.ts` — generateCodeVerifier, generateCodeChallenge, buildLoginUrl, buildSignupUrl
- Login.tsx — PKCE flow, affiliate signup URL with utm params + sidc
- AuthCallback.tsx — verifies state, sends code+verifier to backend, handles errors
- Backend auth_service.py — exchange_code_for_token → get_deriv_accounts → get_otp_ws_url
- Backend auth API — stores OTP WS URL in Redis (1hr TTL), issues JWT (no tokens in JWT)
- Backend config.py — DERIV_CLIENT_ID, AFFILIATE_ID/SIDC/CAMPAIGN, ANTHROPIC_API_KEY
- Backend redis_client.py — async Redis pool
- .env.example — all variables documented
- requirements.txt — redis + anthropic added
- TODO: register OAuth2 app at https://api.deriv.com/dashboard to get DERIV_CLIENT_ID

---

## PHASE 3 — AI Signal Engine + Timing-Aware Execution ✓ COMPLETE
> Backend does all analysis. Fires signal only when confidence clears threshold.
> Signal = { digit, strategy, duration, confidence, entry_window_ms, live_payout }

### 3A — Deriv Client (new API)
- [ ] `backend/app/services/deriv_client.py`
  - [ ] `get_authenticated_ws(account_id, access_token)` → fetch OTP from Redis or re-request, return WS URL
  - [ ] `connect_public_ws()` → `wss://api.derivws.com/trading/v1/options/ws/public` (ticks, no auth)
  - [ ] `connect_trading_ws(otp_url)` → authenticated WS (buy, balance, portfolio)
  - [ ] `fetch_tick_history(symbol, count=5000)` → prices[], times[]
  - [ ] `subscribe_ticks(symbol, callback)` — live tick stream
  - [ ] `get_proposal(symbol, contract_type, barrier, duration, stake, ws)` → proposal_id, ask_price, payout
  - [ ] `execute_buy(proposal_id, ask_price, ws)` → contract_id, purchase_time, balance_after
  - [ ] `subscribe_open_contract(contract_id, callback, ws)` — live P&L updates
  - [ ] `subscribe_balance(callback, ws)` — real-time balance
  - [ ] `subscribe_transaction(callback, ws)` — WIN/LOSS auto-detection
  - [ ] `sell_contract(contract_id, ws)` → early exit
  - [ ] `measure_rtt(ws)` — send `{ time:1 }`, measure response latency
  - [ ] Ping loop every 25s, exponential backoff reconnect (1s → 2s → 4s → max 30s)
  - [ ] `forget_all(ws)` — cleanup on disconnect

### 3B — Analysis Engine
- [ ] `backend/app/services/analysis.py`
  - [ ] `build_transition_matrix(digits)` → 10×10 Markov matrix (last digit → next digit probabilities)
  - [ ] `score_digit_match(digits)` → per digit 0–9:
    - `markov_prob`: P(next=d | last 2 digits) from transition matrix
    - `frequency_deficit`: expected 10% minus actual frequency (positive = overdue)
    - `gap_score`: ticks since digit last appeared (higher = stronger mean-reversion signal)
    - `composite = 0.5 * markov + 0.3 * deficit + 0.2 * gap`
  - [ ] `score_even_odd(digits)` → pEven, pOdd, streak_length, momentum
  - [ ] `score_rise_fall(prices)` → pRise, pFall, streak_reversal_prob, volatility_regime
  - [ ] `score_over_under(digits)` → best_threshold, prob[] for thresholds 1–8
  - [ ] `detect_volatility_regime(prices, window=50)` → "low" / "medium" / "high"
  - [ ] `recommend_duration(strategy, volatility_regime)` → 1, 2, or 5 ticks
  - [ ] `extract_signals(symbol, digits, prices)` → Signal list, sorted by confidence
    - Grade A ≥ 65%, Grade B 55–64%, filter out below 55%
    - Each signal includes: symbol, name, strategy, contract_type, barrier, duration, confidence, edge, grade

### 3C — Timing Engine
- [ ] `backend/app/services/timing.py`
  - [ ] `estimate_tick_interval(recent_times[])` → avg ms between ticks
  - [ ] `compute_entry_window(tick_interval_ms, rtt_ms)` → ms available after current tick to fire order
    - Formula: `entry_window = tick_interval - rtt - 80ms_safety_buffer`
  - [ ] `should_fire_now(last_tick_epoch, rtt_ms, tick_interval_ms)` → bool + ms_until_optimal
  - [ ] `schedule_entry(signal, ws, token)` — waits for optimal window, calls `execute_buy`
  - [ ] Return to frontend: `{ rtt_ms, tick_interval_ms, entry_window_ms, next_tick_in_ms }`

### 3D — Claude AI Explainer
- [ ] `backend/app/services/ai_explainer.py`
  - [ ] `explain_signal(signal_data)` → call `claude-haiku-4-5-20251001`
  - [ ] Input: top 3 digits + their frequencies, transition matrix slice, gap, streak, momentum
  - [ ] Prompt: "You are a trading signal explainer. Given these statistics, explain in exactly 2 sentences why digit N is likely to match in the next M ticks. Be specific about the numbers."
  - [ ] Output: 2-sentence plain English shown on signal card
  - [ ] Redis cache: `explain:{symbol}:{digit}:{round(confidence,1)}` → 30s TTL
  - [ ] Fallback if Claude unavailable: generate template string from raw stats

### 3E — WebSocket Signal Broadcaster
- [ ] `backend/app/core/ws_manager.py`
  - [ ] Per-user connection pool (public WS for ticks, trading WS for execution)
  - [ ] `SignalBroadcaster`: on every tick → run `extract_signals()` → if A/B signal → enrich with live proposal → broadcast
  - [ ] FastAPI `/ws/signals` endpoint — frontend subscribes here (JWT authenticated)
  - [ ] Message types to frontend:
    - `{ type:"signal", data:Signal[] }` — ranked signals with payout
    - `{ type:"tick", symbol, digit, price, epoch }` — every tick
    - `{ type:"balance", balance, currency }` — after each trade
    - `{ type:"trade_opened", contract_id, buy_price, payout, start_time }` — trade confirmed
    - `{ type:"trade_update", contract_id, current_value, profit }` — live P&L
    - `{ type:"trade_settled", contract_id, outcome, profit, exit_tick }` — WIN/LOSS final
    - `{ type:"timing", rtt_ms, tick_interval_ms, next_tick_in_ms }` — entry window
  - [ ] Heartbeat: `{ time:1 }` ping to Deriv every 25s, ping to frontend every 15s

### 3F — Trade API
- [ ] `backend/app/api/trade.py`
  - [ ] `POST /api/trade/proposal` — Body: `{ symbol, contract_type, barrier, duration, stake }`
    - Returns: `{ proposal_id, ask_price, payout, payout_pct, longcode }`
  - [ ] `POST /api/trade/buy` — Body: `{ proposal_id, price }`
    - Uses timing engine: waits for optimal entry window, fires `buy` on trading WS
    - Returns: `{ contract_id, buy_price, payout, purchase_time, balance_after }`
  - [ ] `POST /api/trade/sell` — Body: `{ contract_id }` → early exit at market price
  - [ ] `GET /api/trade/history` — fetches `profit_table` from Deriv (limit/offset params)
  - [ ] `GET /api/trade/open` — fetches `portfolio` (open contracts)
  - [ ] All protected by `Depends(get_current_user)`

### 3G — Tests
- [ ] Transition matrix rows sum to 1.0 ± 0.001
- [ ] Signals sorted by confidence descending
- [ ] Grade A ≥ 0.65, Grade B ≥ 0.55 < 0.65
- [ ] Timing: entry_window > 0 when rtt < tick_interval
- [ ] Commit: `feat: phase 3 - ai signal engine + timing-aware execution`

---

## PHASE 4 — Full Dashboard UI
> Complete trading terminal. Everything inside this app. User never opens Deriv.

### 4A — Pages
- [ ] `/dashboard` — signal tray + instrument cards + live balance (main view)
- [ ] `/journal` — P&L from `profit_table`, win rate chart, session stats
- [ ] `/auto` — automation control (start/pause/stop, configure risk limits)
- [ ] `/settings` — instruments, default stake, min confidence, notifications
- [ ] `/` — landing page: anonymised live signal preview, features, affiliate CTA, login

### 4B — Signal Tray
- [ ] `<SignalTray />` — horizontal scroll, sorted by confidence (A first)
  - Fresh signal (< 3 ticks old): pulse animation
  - Stale (> 10 ticks): fade + auto-remove
- [ ] `<SignalCard />` shows:
  - Strategy badge (MATCH / EVEN / ODD / RISE / FALL / OVER / UNDER)
  - Instrument name large ("Volatility 100")
  - Target digit highlighted (e.g. "3") — large, prominent
  - Confidence % + grade badge (A/B)
  - Recommended duration ("2 ticks")
  - AI explanation (2 sentences)
  - Live payout (e.g. "$10 → $19.90" — updates each tick from proposal subscription)
  - Entry timing bar: "Entry window open · 340ms"
  - **TRADE** button → opens TradeModal

### 4C — Trade Modal (critical UX)
- [ ] `<TradeModal />` — the moment of execution
  - Shows: digit, strategy, instrument, confidence, recommended duration
  - Stake selector: $1 / $5 / $10 / $25 / custom input
  - Live payout from Deriv proposal (updates every tick)
  - Entry timing: "Optimal entry in 280ms" (live countdown from timing engine)
  - RTT: "Server RTT: 42ms"
  - **Place Trade** button:
    - Calls `POST /api/trade/buy`
    - Backend timing engine fires at optimal tick window
    - Button shows "Timing entry…" → "Contract open · $19.90 payout"
  - After entry: live current value from `proposal_open_contract`
  - Auto-closes on contract settle: "WIN +$9.40 🟢" or "LOSS -$10 🔴"
  - No manual WIN/LOSS entry — Deriv's `transaction` subscription tells us automatically

### 4D — Instrument Cards
- [ ] `<InstrumentCard />` per symbol:
  - Last 20 digits as coloured cells (0=grey, 1–4 warm, 5–9 cool)
  - Even/Odd streak indicator
  - Strategy confidence grid (all 6 strategies × current %)
  - Over/Under heatmap (thresholds 1–8)
  - Sparkline (last 50 prices)
  - Live tick interval + RTT

### 4E — Journal (Real Data from Deriv)
- [ ] `<JournalTable />` — from `profit_table` API, paginated
  - Columns: time, symbol, strategy, digit, duration, stake, payout, outcome, net P&L
  - Filters: symbol, strategy, outcome (win/loss), date range
- [ ] `<WinRateChart />` — recharts area chart, rolling win % over 50/100/200 trades
- [ ] `<SessionSummary />` — this session: trades, win rate, net P&L, peak confidence

### 4F — Live Balance in Topbar
- [ ] Replace static win rate pill with live balance from `balance` subscription
- [ ] Show: account currency + balance + session P&L delta (green/red)

### 4G — Hooks
- [ ] `useSignals(symbols)` — subscribes to `/ws/signals`, returns signals[], ticks[], balance
- [ ] `useProposal(signal, stake)` — live payout quote, auto-refreshes each tick
- [ ] `useTradeExecution()` — wraps trade/buy, tracks pending/open/settled state machine
- [ ] `useJournal()` — fetches profit_table, paginates
- [ ] `useBalance()` — live balance stream
- [ ] `useTiming(symbol)` — RTT, tick_interval, entry window countdown

- [ ] Commit: `feat: phase 4 - full trading terminal ui`

---

## PHASE 5 — Automation Bot
> AI runs the full loop. User sets limits and can pause/stop at any time.

- [ ] `backend/app/services/bot.py` — `BotSession`:
  - Config: symbols[], stake, min_grade (A only / A+B), max_trades_per_hour, max_daily_loss_pct, stake_strategy (flat / martingale)
  - Loop: wait for Grade A signal → get proposal → confirm payout% ≥ threshold → `schedule_entry` → buy → monitor → log
  - Martingale: double stake after loss (cap at 4x), reset on win
  - Hard stops: pause if daily loss > limit; pause if 3 consecutive losses
  - Never auto-resume from a loss stop — requires explicit user action
- [ ] `backend/app/api/bot.py`:
  - `POST /api/bot/start` — start session with config
  - `POST /api/bot/pause` / `/resume` / `/stop`
  - `GET /api/bot/status` — live: trades, win rate, P&L, current signal being watched
- [ ] Frontend `/auto` page:
  - Configure form (symbols, stake, min confidence, max loss)
  - Live decision feed: "Watching Vol 100 · waiting for Grade A…", "Signal: Digit 3 MATCH 71% · entering…", "Bought · contract #123"
  - P&L progress bar vs daily loss limit
  - PAUSE / STOP always visible
  - Bot cannot start automatically on login — explicit START required every session
- [ ] Commit: `feat: phase 5 - automation bot`

---

## PHASE 6 — Affiliate Tracking + DB
> First time we actually need a database.

- [ ] PostgreSQL via docker-compose (already scaffolded)
- [ ] SQLAlchemy: `ReferredUser(deriv_acct_id, referred_at, first_trade_at, is_active, utm_campaign)`
- [ ] Alembic migration: `alembic revision --autogenerate -m "create referred_users"`
- [ ] Use NEW signup URL with `prompt=registration&utm_source=AFFILIATE_ID&utm_medium=affiliate&sidc=GUID`
- [ ] `POST /api/affiliate/register` — called from callback when referral params present in state
- [ ] First trade detection via `transaction` subscription (already subscribed per user WS session)
- [ ] `GET /api/affiliate/stats` → referred count, active traders, estimated commission
- [ ] `GET /applications/v1/markup-statistics` → track app markup revenue per month
- [ ] Admin page `/admin/affiliate`
- [ ] Commit: `feat: phase 6 - affiliate tracking`

---

## PHASE 7 — Subscriptions
- [ ] Stripe setup + `POST /api/webhooks/stripe`
- [ ] `Subscription` model: deriv_acct_id, tier, stripe_sub_id, expires_at
- [ ] Tiers:
  - **Free** — live signals, read-only journal
  - **Pro ($19/mo)** — one-click trade, live proposals, full journal
  - **Elite ($49/mo)** — full bot, custom risk settings, priority signals
- [ ] Commit: `feat: phase 7 - subscriptions`

---

## PHASE 8 — Notifications
- [ ] Telegram: Grade A signal → instant message (digit, confidence, payout)
- [ ] Email (SendGrid): daily P&L digest, "bot stopped: loss limit" alert
- [ ] Browser Push: permission prompt in /settings
- [ ] Commit: `feat: phase 8 - notifications`

---

## PHASE 9 — Production Deploy
- [ ] Dockerfile (multi-stage, slim Python)
- [ ] GitHub Actions CI: pytest → tsc → vite build on PR
- [ ] GitHub Actions CD: deploy on merge to main
- [ ] Frontend → Vercel | Backend → Railway | DB → Supabase | Redis → Upstash
- [ ] Custom domain + SSL + Sentry + Uptime Robot
- [ ] Commit: `feat: phase 9 - production deploy`

---

## Backlog
- MCP: `https://mcp-api.deriv.com/mcp` — AI tools query live Deriv data directly
- Bulk purchase: same signal → buy across up to 100 accounts simultaneously
- Accumulator strategy: low volatility → ACCU contracts (compounds tick by tick)
- Multiplier strategy: strong directional signal → MULTUP/MULTDOWN with stop_loss + take_profit via `contract_update`
- Demo mode: trade on demo account to test signals before switching to real
- Signal accuracy tracker: log every signal, track actual outcome, compute true historical edge
- Leaderboard: top performers (opt-in, anonymised)
- Mobile PWA
