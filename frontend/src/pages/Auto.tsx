import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/store/authStore'
import type { BotStatus, BotLogEntry } from '@/types'

function TokenLoginPrompt({ onLoggedIn }: { onLoggedIn: (user: any, jwt: string) => void }) {
  const [apiToken, setApiToken] = useState('')
  const [accountType, setAccountType] = useState<'real' | 'demo'>('demo')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleConnect() {
    if (!apiToken.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: apiToken.trim(), account_type: accountType }),
      })
      let data: any = null
      try { data = await res.json() } catch { /* non-JSON body */ }
      if (!res.ok) throw new Error(data?.detail ?? `Server error (${res.status}) — is the backend running?`)
      onLoggedIn(data.user, data.access_token)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-5">
        <div className="space-y-1">
          <div className="text-sm font-semibold text-ink">Connect Deriv Account</div>
          <div className="text-xs text-ink-muted">
            Auto-trading requires a Deriv API token with <strong>Read + Trade</strong> scope.
          </div>
        </div>

        <div className="rounded-lg bg-surface-3 border border-border p-4 space-y-2 text-xs text-ink-muted">
          <div className="font-semibold text-ink">How to get your token:</div>
          <ol className="space-y-1 list-decimal list-inside">
            <li>Go to <span className="text-brand-blue">home.deriv.com</span></li>
            <li>My Account → API Token</li>
            <li>Create token with Read + Trade scopes</li>
            <li>Token format starts with <code className="text-ink bg-surface-4 px-1 rounded">pat_</code></li>
          </ol>
        </div>

        {/* Account type toggle */}
        <div className="flex rounded-lg border border-border overflow-hidden text-xs font-semibold">
          {(['demo', 'real'] as const).map(type => (
            <button
              key={type}
              onClick={() => setAccountType(type)}
              className={`flex-1 py-2 capitalize transition-colors ${
                accountType === type
                  ? type === 'demo'
                    ? 'bg-brand-blue text-surface'
                    : 'bg-brand-green text-surface'
                  : 'bg-surface-4 text-ink-muted hover:text-ink'
              }`}
            >
              {type === 'demo' ? 'Demo Account' : 'Real Account'}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <input
            type="text"
            value={apiToken}
            onChange={e => setApiToken(e.target.value)}
            placeholder="pat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            className="w-full px-3 py-2 rounded-lg border border-border bg-surface-4 text-ink text-xs font-mono focus:outline-none focus:border-brand-blue"
          />
          {error && <div className="text-xs text-brand-red">{error}</div>}
          <button
            onClick={handleConnect}
            disabled={loading || !apiToken.trim()}
            className="w-full py-2.5 rounded-lg bg-brand-blue text-surface text-sm font-semibold disabled:opacity-50 hover:bg-brand-blue/90 transition-colors"
          >
            {loading ? 'Connecting…' : 'Connect & Enable Auto-Trading'}
          </button>
        </div>
      </div>
    </div>
  )
}

const SYMBOLS = [
  { value: 'R_10',    label: 'Vol 10' },
  { value: 'R_25',    label: 'Vol 25' },
  { value: 'R_50',    label: 'Vol 50' },
  { value: 'R_75',    label: 'Vol 75' },
  { value: 'R_100',   label: 'Vol 100' },
  { value: '1HZ10V',  label: '1s-10' },
  { value: '1HZ25V',  label: '1s-25' },
  { value: '1HZ50V',  label: '1s-50' },
  { value: '1HZ75V',  label: '1s-75' },
  { value: '1HZ100V', label: '1s-100' },
  { value: 'JD10',    label: 'Jump 10' },
  { value: 'JD25',    label: 'Jump 25' },
  { value: 'JD50',    label: 'Jump 50' },
  { value: 'JD75',    label: 'Jump 75' },
  { value: 'JD100',   label: 'Jump 100' },
]

const EVENT_COLORS: Record<string, string> = {
  watching:      'text-ink-muted',
  signal_found:  'text-brand-blue',
  trade_placed:  'text-brand-amber',
  trade_settled: '',   // set below based on win/loss
  paused:        'text-brand-red',
  resumed:       'text-brand-green',
  stopped:       'text-ink-muted',
  skip:          'text-ink-muted',
  error:         'text-brand-red',
}

function logColor(entry: BotLogEntry): string {
  if (entry.event === 'trade_settled') {
    return entry.details.won ? 'text-brand-green' : 'text-brand-red'
  }
  return EVENT_COLORS[entry.event] ?? 'text-ink'
}

function fmtTime(epoch: number): string {
  return new Date(epoch * 1000).toLocaleTimeString()
}

export default function Auto() {
  const { token, setAuth } = useAuthStore()
  const isDev = !token || token === 'dev-token'
  const qc = useQueryClient()

  // Config form state
  const [symbols, setSymbols]       = useState(['R_10', 'R_50', 'R_100', '1HZ10V', '1HZ100V'])
  const [stake, setStake]           = useState(10)
  const [minGrade, setMinGrade]     = useState<'A' | 'AB'>('AB')
  const [maxTrades, setMaxTrades]   = useState(20)
  const [maxLoss, setMaxLoss]       = useState(20)
  const [strategy, setStrategy]     = useState<'flat' | 'martingale'>('flat')
  const [startBalance, setStartBalance] = useState(1000)
  const [maxConsecLosses, setMaxConsecLosses] = useState(0)

  // Poll bot status every 2s when page is open
  const { data: bot } = useQuery<BotStatus>({
    queryKey: ['bot-status'],
    queryFn: async () => {
      const resp = await fetch('/api/bot/status', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!resp.ok) throw new Error('Status fetch failed')
      return resp.json()
    },
    refetchInterval: 2000,
    enabled: !!token && !isDev,
  })

  // Sync live balance to header
  useEffect(() => {
    if (bot?.current_balance != null) {
      window.dispatchEvent(new CustomEvent('dst:balance', { detail: bot.current_balance }))
    }
  }, [bot?.current_balance])

  const isRunning = bot?.status === 'running'
  const isPaused  = bot?.status === 'paused'
  const isActive  = isRunning || isPaused

  async function apiPost(path: string, body?: object) {
    const r = await fetch(`/api/bot${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    let data: any = null
    try { data = await r.json() } catch { /* non-JSON body */ }
    if (!r.ok) throw new Error(data?.detail ?? `Server error (${r.status}) — is the backend running?`)
    return data
  }

  const startMut = useMutation({
    mutationFn: () => apiPost('/start', {
      symbols,
      stake,
      min_grade: minGrade,
      max_trades_per_hour: maxTrades,
      max_daily_loss_pct: maxLoss,
      stake_strategy: strategy,
      starting_balance: startBalance,
      max_consecutive_losses: maxConsecLosses,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bot-status'] }),
  })

  const pauseMut  = useMutation({ mutationFn: () => apiPost('/pause'),  onSuccess: () => qc.invalidateQueries({ queryKey: ['bot-status'] }) })
  const resumeMut = useMutation({ mutationFn: () => apiPost('/resume'), onSuccess: () => qc.invalidateQueries({ queryKey: ['bot-status'] }) })
  const stopMut   = useMutation({ mutationFn: () => apiPost('/stop'),   onSuccess: () => qc.invalidateQueries({ queryKey: ['bot-status'] }) })

  const error = startMut.error?.message ?? pauseMut.error?.message ?? resumeMut.error?.message ?? stopMut.error?.message

  function toggleSymbol(sym: string) {
    setSymbols(prev =>
      prev.includes(sym) ? prev.filter(s => s !== sym) : [...prev, sym]
    )
  }

  if (isDev) {
    return <TokenLoginPrompt onLoggedIn={(user, jwt) => { setAuth(user, jwt) }} />
  }

  const dailyLossPct = bot && bot.daily_loss_limit > 0
    ? Math.min((bot.daily_loss / bot.daily_loss_limit) * 100, 100)
    : 0

  return (
    <div className="flex-1 flex gap-4 p-4 overflow-hidden">

      {/* Left — Config form (hidden when bot is active) */}
      {!isActive && (
        <div className="w-64 shrink-0 flex flex-col overflow-y-auto">
          <div className="bg-surface-2 rounded-lg border border-border p-3 space-y-3">
            <div className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">Bot Configuration</div>

            {/* Symbols — 3-column grid */}
            <div className="space-y-1">
              <label className="text-[11px] text-ink-muted">Instruments</label>
              <div className="grid grid-cols-3 gap-0.5">
                {SYMBOLS.map(({ value, label }) => (
                  <label key={value} className={`flex items-center gap-1 px-1 py-0.5 rounded cursor-pointer text-[11px] ${symbols.includes(value) ? 'text-brand-blue' : 'text-ink-muted hover:text-ink'}`}>
                    <input
                      type="checkbox"
                      checked={symbols.includes(value)}
                      onChange={() => toggleSymbol(value)}
                      className="accent-brand-blue w-3 h-3 shrink-0"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            {/* Stake + Grade in one row */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-0.5">
                <label className="text-[11px] text-ink-muted">Stake ($)</label>
                <input type="number" min={1} step={1} value={stake}
                  onChange={e => setStake(Number(e.target.value))}
                  className="w-full px-2 py-1 rounded border border-border bg-surface-4 text-ink text-xs focus:outline-none" />
              </div>
              <div className="space-y-0.5">
                <label className="text-[11px] text-ink-muted">Max trades/hr</label>
                <input type="number" min={1} max={60} value={maxTrades}
                  onChange={e => setMaxTrades(Number(e.target.value))}
                  className="w-full px-2 py-1 rounded border border-border bg-surface-4 text-ink text-xs focus:outline-none" />
              </div>
            </div>

            {/* Min grade */}
            <div className="space-y-0.5">
              <label className="text-[11px] text-ink-muted">Signal grade</label>
              <select value={minGrade} onChange={e => setMinGrade(e.target.value as 'A' | 'AB')}
                className="w-full px-2 py-1 rounded border border-border bg-surface-4 text-ink text-xs focus:outline-none">
                <option value="A">Grade A only (≥65%)</option>
                <option value="AB">Grade A + B (≥55%)</option>
              </select>
            </div>

            {/* Stake strategy */}
            <div className="space-y-0.5">
              <label className="text-[11px] text-ink-muted">Stake strategy</label>
              <select value={strategy} onChange={e => setStrategy(e.target.value as 'flat' | 'martingale')}
                className="w-full px-2 py-1 rounded border border-border bg-surface-4 text-ink text-xs focus:outline-none">
                <option value="flat">Flat stake</option>
                <option value="martingale">Martingale (2× after loss)</option>
              </select>
            </div>

            {/* Max daily loss + Consecutive loss limit */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-0.5">
                <label className="text-[11px] text-ink-muted">Max loss (%)</label>
                <input type="number" min={1} max={100} value={maxLoss}
                  onChange={e => setMaxLoss(Number(e.target.value))}
                  className="w-full px-2 py-1 rounded border border-border bg-surface-4 text-ink text-xs focus:outline-none" />
              </div>
              <div className="space-y-0.5">
                <label className="text-[11px] text-ink-muted">Consec losses (0=∞)</label>
                <input type="number" min={0} max={20} value={maxConsecLosses}
                  onChange={e => setMaxConsecLosses(Number(e.target.value))}
                  className="w-full px-2 py-1 rounded border border-border bg-surface-4 text-ink text-xs focus:outline-none" />
              </div>
            </div>

            {/* Starting balance */}
            <div className="space-y-0.5">
              <label className="text-[11px] text-ink-muted">Account balance ($)</label>
              <input type="number" min={1} value={startBalance}
                onChange={e => setStartBalance(Number(e.target.value))}
                className="w-full px-2 py-1 rounded border border-border bg-surface-4 text-ink text-xs focus:outline-none" />
            </div>

            {error && (
              <div className="text-xs text-brand-red bg-brand-red/10 px-2 py-1.5 rounded">{error}</div>
            )}

            <button
              onClick={() => startMut.mutate()}
              disabled={startMut.isPending || symbols.length === 0}
              className="w-full py-2 rounded text-sm font-semibold bg-brand-green/15 text-brand-green border border-brand-green/30 hover:bg-brand-green/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {startMut.isPending ? 'Starting…' : '▶ Start Bot'}
            </button>
          </div>
        </div>
      )}

      {/* Right — Live status + log */}
      <div className="flex-1 flex flex-col gap-4 min-w-0 overflow-hidden">

        {/* Status bar */}
        {bot && bot.status !== 'idle' && (
          <div className="bg-surface-2 rounded-lg border border-border p-4 space-y-3">
            {/* Top row: status badge + controls */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`shrink-0 px-2 py-0.5 rounded text-xs font-semibold ${
                  isRunning ? 'bg-brand-green/15 text-brand-green' :
                  isPaused  ? 'bg-brand-amber/15 text-brand-amber' :
                              'bg-surface-4 text-ink-muted'
                }`}>
                  {bot.status.toUpperCase()}
                </span>
                {bot.current_tier && (
                  <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                    bot.current_tier === 'safe'      ? 'bg-brand-green/10 text-brand-green' :
                    bot.current_tier === 'medium'    ? 'bg-brand-blue/10 text-brand-blue' :
                                                       'bg-brand-amber/10 text-brand-amber'
                  }`}>
                    {bot.current_tier}
                  </span>
                )}
                {bot.current_symbol && (
                  <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono bg-surface-4 text-ink-muted">
                    {bot.current_symbol}
                  </span>
                )}
                <span className="text-xs text-ink-muted truncate">{bot.current_watch}</span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {isRunning && (
                  <button
                    onClick={() => pauseMut.mutate()}
                    disabled={pauseMut.isPending}
                    className="px-3 py-1 rounded text-xs font-semibold bg-brand-amber/15 text-brand-amber border border-brand-amber/30 hover:bg-brand-amber/25 disabled:opacity-40 transition-colors"
                  >
                    ⏸ Pause
                  </button>
                )}
                {isPaused && (
                  <button
                    onClick={() => resumeMut.mutate()}
                    disabled={resumeMut.isPending}
                    className="px-3 py-1 rounded text-xs font-semibold bg-brand-green/15 text-brand-green border border-brand-green/30 hover:bg-brand-green/25 disabled:opacity-40 transition-colors"
                  >
                    ▶ Resume
                  </button>
                )}
                <button
                  onClick={() => stopMut.mutate()}
                  disabled={stopMut.isPending}
                  className="px-3 py-1 rounded text-xs font-semibold bg-brand-red/15 text-brand-red border border-brand-red/30 hover:bg-brand-red/25 disabled:opacity-40 transition-colors"
                >
                  ■ Stop
                </button>
              </div>
            </div>

            {/* Metrics grid */}
            <div className="grid grid-cols-4 gap-3">
              <Metric label="Trades" value={String(bot.trades_total)} />
              <Metric
                label="Win Rate"
                value={bot.trades_total ? `${(bot.win_rate * 100).toFixed(0)}%` : '—'}
              />
              <Metric
                label="Net P&L"
                value={`${bot.net_pnl >= 0 ? '+' : ''}$${bot.net_pnl.toFixed(2)}`}
                color={bot.net_pnl >= 0 ? 'text-brand-green' : 'text-brand-red'}
              />
              <Metric
                label="Stake"
                value={`$${bot.current_stake.toFixed(2)}`}
                sub={bot.config?.stake_strategy === 'martingale' ? 'martingale' : undefined}
              />
            </div>

            {/* Daily loss progress bar */}
            {bot.daily_loss_limit > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] text-ink-muted">
                  <span>Daily loss</span>
                  <span>${bot.daily_loss.toFixed(2)} / ${bot.daily_loss_limit.toFixed(2)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-surface-4 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      dailyLossPct >= 80 ? 'bg-brand-red' :
                      dailyLossPct >= 50 ? 'bg-brand-amber' :
                                           'bg-brand-green'
                    }`}
                    style={{ width: `${dailyLossPct}%` }}
                  />
                </div>
              </div>
            )}

            {isPaused && (
              <div className="text-xs text-brand-amber bg-brand-amber/10 px-2 py-1.5 rounded">
                Bot paused — manual resume required. Check the log for reason.
              </div>
            )}
          </div>
        )}

        {/* Idle state */}
        {(!bot || bot.status === 'idle') && (
          <div className="flex-1 flex flex-col items-center justify-center text-center space-y-2">
            <div className="text-ink-muted text-sm">No active bot session</div>
            <div className="text-ink-muted/60 text-xs">Configure and start the bot using the panel on the left.</div>
          </div>
        )}

        {/* Decision log — newest first */}
        {bot && bot.log && bot.log.length > 0 && (
          <div className="flex-1 bg-surface-2 rounded-lg border border-border flex flex-col min-h-0">
            <div className="px-4 py-2 border-b border-border text-xs font-semibold text-ink-muted uppercase tracking-wider shrink-0">
              Decision Log
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-2 space-y-0.5 font-mono">
              {[...bot.log].reverse().map((entry, i) => (
                <div key={i} className="flex items-start gap-3 py-0.5">
                  <span className="text-[10px] text-ink-muted shrink-0 pt-px">{fmtTime(entry.time)}</span>
                  <span className={`text-xs ${logColor(entry)}`}>{entry.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Metric({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div className="bg-surface-4 rounded px-3 py-2">
      <div className="text-[10px] text-ink-muted mb-0.5">{label}</div>
      <div className={`text-sm font-semibold ${color ?? 'text-ink'}`}>{value}</div>
      {sub && <div className="text-[10px] text-ink-muted">{sub}</div>}
    </div>
  )
}
