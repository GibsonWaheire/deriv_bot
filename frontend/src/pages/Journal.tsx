import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/store/authStore'

const PAGE_SIZE = 25

interface JournalEntry {
  contract_id: number
  contract_type: string
  shortcode: string
  sell_price: number
  buy_price: number
  profit_loss: number
  sell_time: number
  duration_type: string
  longcode?: string
}

export default function Journal() {
  const { token } = useAuthStore()
  const [offset, setOffset] = useState(0)
  const isDev = token === 'dev-token'

  const { data, isLoading, error } = useQuery({
    queryKey: ['journal', offset],
    queryFn: async () => {
      const resp = await fetch(
        `/api/trade/history?limit=${PAGE_SIZE}&offset=${offset}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (!resp.ok) {
        const e = await resp.json()
        throw new Error(e.detail ?? 'Failed to load history')
      }
      return resp.json()
    },
    enabled: !!token && !isDev,
  })

  const entries: JournalEntry[] = data?.transactions ?? []
  const total: number = data?.count ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)
  const page = Math.floor(offset / PAGE_SIZE)

  // Compute session stats from loaded entries
  const wins = entries.filter(e => e.profit_loss > 0).length
  const losses = entries.filter(e => e.profit_loss < 0).length
  const netPnl = entries.reduce((sum, e) => sum + e.profit_loss, 0)
  const winRate = entries.length ? (wins / entries.length) * 100 : 0

  return (
    <div className="p-5 space-y-5">
      <div className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
        Trade Journal
      </div>

      {/* Dev bypass notice */}
      {isDev && (
        <div className="px-4 py-3 rounded-lg bg-brand-yellow/10 border border-brand-yellow/25 text-brand-yellow text-xs">
          Dev bypass active — connect with a real Deriv account to see trade history.
        </div>
      )}

      {/* Stats bar */}
      {entries.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Trades', value: String(entries.length) },
            { label: 'Win Rate', value: `${winRate.toFixed(1)}%`, color: 'text-brand-green' },
            { label: 'Wins', value: String(wins), color: 'text-brand-green' },
            { label: 'Net P&L', value: `${netPnl >= 0 ? '+' : ''}$${netPnl.toFixed(2)}`, color: netPnl >= 0 ? 'text-brand-green' : 'text-brand-red' },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-lg bg-surface-2 border border-border p-3">
              <div className="text-[10px] text-ink-muted mb-1">{label}</div>
              <div className={`text-lg font-bold ${color ?? 'text-ink'}`}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-surface-3">
              {['Time', 'Contract', 'Stake', 'Payout', 'P&L'].map(h => (
                <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold text-ink-muted uppercase tracking-wider">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink-muted">
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-brand-blue border-t-transparent rounded-full animate-spin" />
                    Loading trades…
                  </span>
                </td>
              </tr>
            )}

            {error && !isDev && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-brand-red text-xs">
                  {error instanceof Error ? error.message : 'Failed to load'}
                </td>
              </tr>
            )}

            {!isLoading && !error && entries.length === 0 && !isDev && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink-muted">
                  No trades yet — make your first trade from the Dashboard.
                </td>
              </tr>
            )}

            {entries.map(entry => {
              const pnl = entry.profit_loss
              return (
                <tr key={entry.contract_id} className="border-b border-border hover:bg-surface-3 transition-colors">
                  <td className="px-4 py-3 font-mono text-ink-muted">
                    {new Date(entry.sell_time * 1000).toLocaleTimeString()}
                  </td>
                  <td className="px-4 py-3 text-ink">
                    {entry.contract_type}
                    {entry.shortcode && (
                      <span className="ml-1 text-ink-muted">
                        {entry.shortcode.split('_').slice(0, 2).join(' ')}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-ink">
                    ${entry.buy_price.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 font-mono text-ink">
                    ${entry.sell_price.toFixed(2)}
                  </td>
                  <td className={`px-4 py-3 font-mono font-semibold ${pnl > 0 ? 'text-brand-green' : pnl < 0 ? 'text-brand-red' : 'text-ink-muted'}`}>
                    {pnl > 0 ? '+' : ''}{pnl.toFixed(2)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-ink-muted">
          <span>Page {page + 1} of {totalPages} · {total} total trades</span>
          <div className="flex gap-2">
            <button
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
              className="px-3 py-1.5 rounded border border-border bg-surface-4 hover:bg-surface-5 disabled:opacity-40 transition-colors"
            >
              ← Prev
            </button>
            <button
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= total}
              className="px-3 py-1.5 rounded border border-border bg-surface-4 hover:bg-surface-5 disabled:opacity-40 transition-colors"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
