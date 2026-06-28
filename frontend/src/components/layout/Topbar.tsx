import { useAuthStore } from '@/store/authStore'

interface TopbarProps {
  rtt?: number | null
  balance?: number | null
  tradeCount?: number
  status?: 'offline' | 'connecting' | 'live' | 'error'
}

const STATUS_DOT: Record<string, string> = {
  live:       'bg-brand-green shadow-[0_0_6px_2px_rgba(0,212,160,0.5)]',
  connecting: 'bg-brand-yellow animate-pulse',
  error:      'bg-brand-red shadow-[0_0_6px_2px_rgba(255,60,78,0.5)]',
  offline:    'bg-ink-muted',
}

const STATUS_LABEL: Record<string, string> = {
  live:       'Live',
  connecting: 'Connecting…',
  error:      'Error',
  offline:    'Offline',
}

export default function Topbar({ rtt, balance, tradeCount = 0, status = 'offline' }: TopbarProps) {
  const { user, clearAuth, isLoggedIn } = useAuthStore()

  // Show balance from props (live) or from stored user (initial)
  const displayBalance = balance ?? user?.balance ?? null
  const currency = user?.currency ?? 'USD'
  const accountType = (user as any)?.account_type ?? ''

  return (
    <header className="flex items-center justify-between px-4 h-12 bg-surface-2 border-b border-border shrink-0">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-8 h-8 rounded bg-brand-blue/20 text-brand-blue font-mono font-bold text-xs">
          DST
        </div>
        <div>
          <div className="text-ink text-sm font-semibold leading-none">Digit Strategy Terminal</div>
          <div className="text-ink-muted text-[11px] leading-none mt-0.5">Deriv AI Synthetic · Auto-Analysis</div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Pill label="RTT" value={rtt != null ? `${Math.round(rtt)}ms` : '—'} />

        {/* Live balance */}
        <Pill
          label={`${currency}${accountType === 'demo' ? ' demo' : ''}`}
          value={displayBalance != null ? displayBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
          valueClass="text-brand-green font-semibold"
        />

        <Pill label="Trades" value={String(tradeCount)} />

        {/* Status */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-4 border border-border text-xs">
          <span className={`w-2 h-2 rounded-full ${STATUS_DOT[status]}`} />
          <span className="text-ink">{STATUS_LABEL[status]}</span>
        </div>

        {/* User */}
        {isLoggedIn && user && (
          <button
            onClick={clearAuth}
            className="px-2.5 py-1 text-xs rounded border border-border bg-surface-4 text-ink-muted hover:text-ink hover:border-border-2 transition-colors"
          >
            {user.deriv_account_id} · Logout
          </button>
        )}
      </div>
    </header>
  )
}

function Pill({
  label,
  value,
  valueClass = 'text-ink',
}: {
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-4 border border-border text-xs">
      <span className="text-ink-muted">{label}</span>
      <span className={valueClass}>{value}</span>
    </div>
  )
}
