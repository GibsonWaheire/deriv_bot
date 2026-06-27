# Deriv Bot — Project TODO
> Update this file on every commit. Remove completed tasks. Add new ones as they emerge.
> Last updated: 2026-06-27

---

## Current Status
**Phase 2 complete** — Deriv OAuth2 login flow. Backend verifies token via Deriv WS, issues JWT. Protected routes reject bad tokens with 401. No DB needed — Deriv owns user data.
**Next:** Start Phase 3 — Python analysis engine (port JS signal algorithms to FastAPI, WebSocket `/ws/signals`).

**Repo:** https://github.com/GibsonWaheire/deriv_bot.git
**Stack:** Vite · React · TypeScript · Tailwind CSS · FastAPI (Python) · PostgreSQL · Redis

---

## What Was Built (Prototype — `main` branch)
- `index.html` + `style.css` + `app.js` + `feed.js`
- Connects to Deriv WebSocket API (real live ticks + ticks_history)
- Multi-instrument monitoring (Vol 10/25/50/75/100, 1s indices, Jump indices)
- Auto-fetches up to 5000 real historical ticks per instrument on connect
- Signal engine: Digit Match (Markov chain), Even/Odd, Rise/Fall, Over/Under
- Signal cards — horizontal scrollable tray, real-time RAF-debounced updates
- Instrument cards — live digit strip, strategy breakdown, over/under grid
- Trade timing modal — click timestamp, server RTT, entry time estimate
- Trade journal — localStorage, win rate tracking
- Friendly instrument names (Volatility 100, Jump 50, etc.)

---

---

---

## PHASE 3 — Python Analysis Engine
> Goal: Port JS signal algorithms to Python. Server runs analysis, frontend only displays.

- [ ] `backend/app/services/analysis.py`
  - [ ] `build_transition_matrix(digits)` → 10×10 matrix
  - [ ] `score_digit_match(digits)` → ranked list per digit 0-9
  - [ ] `score_even_odd(digits)` → pEven, pOdd, streak, trend
  - [ ] `score_rise_fall(prices)` → pRise, pFall, streak reversal probability
  - [ ] `score_over_under(digits)` → best threshold + probability per threshold 1-8
  - [ ] `extract_signals(symbol, digits, prices)` → ranked Signal list
- [ ] `backend/app/services/deriv_client.py`
  - [ ] `fetch_tick_history(symbol, count, api_token)` — calls Deriv WS, returns prices
  - [ ] `subscribe_ticks(symbol, api_token, on_tick_callback)` — live stream
- [ ] `backend/app/core/ws_manager.py`
  - [ ] Per-user WebSocket connection pool (one Deriv WS per logged-in user)
  - [ ] `/ws/signals` endpoint — frontend connects, receives live signal updates
- [ ] Unit tests for all analysis functions (`pytest`)
- [ ] Commit: `feat: phase 3 - python analysis engine`

---

## PHASE 4 — React Dashboard UI
> Goal: Full React rebuild of the current prototype. Tailwind styled. Connected to FastAPI.

- [ ] Pages
  - [ ] `/` — Landing page: headline, feature list, affiliate CTA, login button
  - [ ] `/dashboard` — Main signal terminal (protected)
  - [ ] `/journal` — Trade history + win rate charts (protected)
  - [ ] `/settings` — Instrument selection, preferences (protected)
- [ ] Components
  - [ ] `<SignalTray />` — horizontal scrollable signal cards, live via `/ws/signals`
  - [ ] `<SignalCard />` — strategy type, friendly name, probability gauge, TRADE button
  - [ ] `<InstrumentCard />` — per-symbol: digit strip, strategy cells, over/under grid
  - [ ] `<TradeModal />` — click timing, RTT, entry estimate, WIN/LOSS logger
  - [ ] `<JournalTable />` — paginated, filterable trade log
  - [ ] `<WinRateChart />` — recharts line chart, win % over time
  - [ ] `<Topbar />` — RTT, win rate, trade count, status dot, sound toggle
  - [ ] `<Sidebar />` — instrument checkboxes, history depth, connect button, journal
- [ ] Custom React hooks
  - [ ] `useSignals()` — manages WebSocket connection to `/ws/signals`
  - [ ] `useJournal()` — CRUD for trade journal (moves from localStorage → API)
  - [ ] `useAuth()` — current user, token, logout
- [ ] Commit: `feat: phase 4 - react dashboard ui`

---

## PHASE 5 — Affiliate Tracking
> Goal: Every new Deriv user who signs up through the app is tracked to your affiliate ID.

- [ ] Add affiliate ID to `.env`
- [ ] Landing page "Sign up" button → routes through affiliate tracking link first
- [ ] Backend `referred_users` table: deriv_acct_id, referred_at, is_active
- [ ] Track when a referred user first makes a trade (via Deriv WS `buy` events)
- [ ] Admin page `/admin/affiliate` — referred count, active traders, estimated earnings
- [ ] Commit: `feat: phase 5 - affiliate tracking`

---

## PHASE 6 — Subscriptions (Optional but recommended)
> Goal: Monetize with subscription tiers on top of affiliate income.

- [ ] Stripe account setup + webhook endpoint
- [ ] `Subscription` model: user_id, tier, stripe_subscription_id, expires_at
- [ ] Tier enforcement middleware on protected API routes
- [ ] Pricing page on landing: Free / Pro $19/mo / Elite $49/mo
- [ ] Stripe Checkout integration
- [ ] Webhook: `customer.subscription.updated` → update DB
- [ ] Commit: `feat: phase 6 - stripe subscriptions`

---

## PHASE 7 — Notifications
> Goal: Alert users when a strong signal fires, even when the browser is closed.

- [ ] Email (SendGrid) — signal digest, "strong signal detected" trigger email
- [ ] Telegram bot — instant push when signal confidence > user threshold
- [ ] Browser Push (Web Push API) — permission prompt in dashboard settings
- [ ] User notification preferences in `/settings`
- [ ] Commit: `feat: phase 7 - notifications`

---

## PHASE 8 — Production Deploy
> Goal: Live, monitored, auto-deploying.

- [ ] GitHub Actions CI: lint → test → build on every PR
- [ ] GitHub Actions CD: deploy on merge to `main`
- [ ] Frontend → Vercel (connect GitHub repo, auto-deploy)
- [ ] Backend → Railway or Render (Dockerfile)
- [ ] Database → Supabase (managed PostgreSQL, free tier)
- [ ] Redis → Upstash (serverless Redis, free tier)
- [ ] Custom domain + SSL
- [ ] Sentry error tracking (frontend + backend)
- [ ] Uptime Robot monitoring
- [ ] Commit: `feat: phase 8 - production deploy`

---

## Backlog / Future Ideas
- Mobile app (React Native or PWA)
- Telegram bot that sends signals without opening browser
- User-configurable signal thresholds saved per account
- Signal accuracy tracking — app logs what it recommended and checks outcome
- Leaderboard — top performing users (opt-in)
- Multi-language support
