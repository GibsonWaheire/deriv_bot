import type { Signal } from '@/types'
import SignalCard from './SignalCard'

interface Props {
  signals: Signal[]
  status: string
  onTrade: (signal: Signal) => void
}

export default function SignalTray({ signals, status, onTrade }: Props) {
  const isEmpty = signals.length === 0

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        <span className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
          Top Signals
        </span>
        {signals.length > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-brand-green/15 text-brand-green text-[10px] font-semibold border border-brand-green/30">
            {signals.length} active
          </span>
        )}
        {/* Grade A count */}
        {signals.filter(s => s.grade === 'A').length > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-brand-green/25 text-brand-green text-[10px] font-bold border border-brand-green/40">
            {signals.filter(s => s.grade === 'A').length}A
          </span>
        )}
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="flex gap-3" style={{ minWidth: 'max-content' }}>
          {isEmpty ? (
            <div className="flex items-center justify-center w-64 h-36 rounded-xl border border-border bg-surface-2 text-ink-muted text-sm">
              {status === 'connecting' ? (
                <span className="flex items-center gap-2">
                  <span className="w-3 h-3 border-2 border-brand-blue border-t-transparent rounded-full animate-spin" />
                  Connecting…
                </span>
              ) : status === 'live' ? (
                'Analyzing ticks…'
              ) : status === 'error' ? (
                'Connection error'
              ) : (
                'Waiting for signals…'
              )}
            </div>
          ) : (
            signals.map((signal, i) => (
              <SignalCard key={`${signal.symbol}-${signal.strategy}-${i}`} signal={signal} onTrade={onTrade} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
