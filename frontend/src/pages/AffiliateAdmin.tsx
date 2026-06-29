import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/store/authStore'

interface AffiliateStats {
  total_referred: number
  active_traders: number
  conversion_rate: number
}

interface MarkupData {
  data?: Array<{
    date: string
    markup_revenue: number
    transaction_count: number
  }>
  error?: string
}

function authHeader(token: string | null) {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export default function AffiliateAdmin() {
  const { token } = useAuthStore()
  const today = new Date().toISOString().split('T')[0]
  const firstOfMonth = today.slice(0, 8) + '01'
  const [dateFrom, setDateFrom] = useState(firstOfMonth)
  const [dateTo, setDateTo]     = useState(today)

  const { data: stats, isLoading: statsLoading, error: statsError } = useQuery<AffiliateStats>({
    queryKey: ['affiliate-stats'],
    queryFn: async () => {
      const resp = await fetch('/api/affiliate/stats', { headers: authHeader(token) })
      if (!resp.ok) throw new Error('Failed to load stats')
      return resp.json()
    },
    enabled: !!token,
  })

  const { data: markup, isLoading: markupLoading, refetch: refetchMarkup } = useQuery<MarkupData>({
    queryKey: ['affiliate-markup', dateFrom, dateTo],
    queryFn: async () => {
      const resp = await fetch(
        `/api/affiliate/markup?date_from=${dateFrom}&date_to=${dateTo}`,
        { headers: authHeader(token) }
      )
      if (!resp.ok) throw new Error('Failed to load markup')
      return resp.json()
    },
    enabled: false,   // only fetch when user clicks
  })

  const totalMarkup = markup?.data?.reduce((sum, r) => sum + (r.markup_revenue ?? 0), 0) ?? 0

  return (
    <div className="flex-1 p-6 space-y-6 overflow-y-auto">
      <div className="text-sm font-semibold text-ink">Affiliate Dashboard</div>

      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard
          label="Total Referred"
          value={statsLoading ? '…' : String(stats?.total_referred ?? 0)}
        />
        <StatCard
          label="Active Traders"
          value={statsLoading ? '…' : String(stats?.active_traders ?? 0)}
          sub="placed ≥1 trade"
        />
        <StatCard
          label="Conversion Rate"
          value={statsLoading ? '…' : `${stats?.conversion_rate ?? 0}%`}
          color={
            (stats?.conversion_rate ?? 0) >= 30 ? 'text-brand-green' :
            (stats?.conversion_rate ?? 0) >= 10 ? 'text-brand-amber' :
                                                   'text-ink'
          }
        />
      </div>

      {statsError && (
        <div className="text-xs text-brand-red bg-brand-red/10 px-3 py-2 rounded">
          Could not load stats — is the database running?
        </div>
      )}

      {/* Markup revenue */}
      <div className="bg-surface-2 rounded-lg border border-border p-4 space-y-3">
        <div className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
          App Markup Revenue (Deriv)
        </div>

        <div className="flex items-end gap-3">
          <div className="space-y-1">
            <label className="text-[10px] text-ink-muted">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="px-2 py-1 rounded border border-border bg-surface-4 text-ink text-xs focus:outline-none"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-ink-muted">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="px-2 py-1 rounded border border-border bg-surface-4 text-ink text-xs focus:outline-none"
            />
          </div>
          <button
            onClick={() => refetchMarkup()}
            disabled={markupLoading}
            className="px-3 py-1 rounded text-xs font-semibold bg-brand-blue/15 text-brand-blue border border-brand-blue/30 hover:bg-brand-blue/25 disabled:opacity-40 transition-colors"
          >
            {markupLoading ? 'Loading…' : 'Fetch'}
          </button>
        </div>

        {markup?.error && (
          <div className="text-xs text-brand-amber bg-brand-amber/10 px-2 py-1.5 rounded">
            {markup.error}
          </div>
        )}

        {markup?.data && markup.data.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-ink-muted">Total period revenue</span>
              <span className="font-semibold text-brand-green">${totalMarkup.toFixed(2)}</span>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-ink-muted border-b border-border">
                  <th className="text-left py-1">Date</th>
                  <th className="text-right py-1">Trades</th>
                  <th className="text-right py-1">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {markup.data.map(row => (
                  <tr key={row.date} className="border-b border-border/50 hover:bg-surface-4">
                    <td className="py-1 text-ink-muted">{row.date}</td>
                    <td className="py-1 text-right text-ink">{row.transaction_count}</td>
                    <td className="py-1 text-right text-brand-green">${row.markup_revenue?.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {markup?.data && markup.data.length === 0 && (
          <div className="text-xs text-ink-muted">No markup revenue in this period.</div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, color }: {
  label: string; value: string; sub?: string; color?: string
}) {
  return (
    <div className="bg-surface-2 rounded-lg border border-border p-4">
      <div className="text-[10px] text-ink-muted mb-1">{label}</div>
      <div className={`text-2xl font-semibold ${color ?? 'text-ink'}`}>{value}</div>
      {sub && <div className="text-[10px] text-ink-muted mt-0.5">{sub}</div>}
    </div>
  )
}
