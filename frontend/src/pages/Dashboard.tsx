import { useEffect, useState } from 'react'
import type { Signal } from '@/types'
import { useSignals } from '@/hooks/useSignals'
import PredictionPanel from '@/components/dashboard/PredictionPanel'
import SignalCard from '@/components/dashboard/SignalCard'
import TradeModal from '@/components/dashboard/TradeModal'

export default function Dashboard() {
  const { signals, timing, timingAt, status, rtt, errorMsg } = useSignals()
  const [tradeSignal, setTradeSignal] = useState<Signal | null>(null)

  // Propagate status + rtt to Layout topbar
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('dst:status', { detail: status }))
  }, [status])

  useEffect(() => {
    if (rtt != null) window.dispatchEvent(new CustomEvent('dst:rtt', { detail: rtt }))
  }, [rtt])

  const topSignal = signals[0] ?? null
  const queueSignals = signals.slice(1)

  return (
    <div className="p-5 space-y-5 min-h-full">

      {/* Connection status banners */}
      {status === 'error' && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand-red/10 border border-brand-red/25 text-brand-red text-xs">
          <span className="font-semibold">Connection error</span>
          {errorMsg && <span className="text-brand-red/70">— {errorMsg}</span>}
        </div>
      )}

      {/* === TOP SIGNAL — full hero prediction === */}
      {topSignal ? (
        <PredictionPanel
          signal={topSignal}
          timing={timing}
          timingAt={timingAt}
          onTrade={setTradeSignal}
        />
      ) : (
        <div className="rounded-2xl border border-border bg-surface-2 p-10 flex flex-col items-center justify-center text-center gap-4">
          {status === 'connecting' || status === 'live' ? (
            <>
              <div className="w-8 h-8 border-2 border-brand-blue border-t-transparent rounded-full animate-spin" />
              <div className="text-sm text-ink-muted">
                {status === 'connecting' ? 'Connecting to Deriv…' : 'Loading tick history and computing signals…'}
              </div>
              <div className="text-xs text-ink-muted opacity-60">
                Fetching 1,000 ticks per symbol · Running Markov analysis
              </div>
            </>
          ) : (
            <>
              <div className="text-4xl text-ink-muted">◎</div>
              <p className="text-sm text-ink-muted">
                Click <span className="text-ink font-medium">Connect &amp; Analyze</span> in the sidebar
              </p>
              <p className="text-xs text-ink-muted opacity-60">
                Signals appear when a statistical edge is detected — not just high base probability.
              </p>
            </>
          )}
        </div>
      )}

      {/* === SIGNAL QUEUE === */}
      {queueSignals.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <span className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
              Signal Queue
            </span>
            <span className="text-[10px] text-ink-muted">
              — next best opportunities across all instruments
            </span>
          </div>
          <div className="space-y-1.5">
            {queueSignals.map((signal, i) => (
              <SignalCard
                key={`${signal.symbol}-${signal.strategy}-${i}`}
                rank={i + 2}
                signal={signal}
                onTrade={setTradeSignal}
              />
            ))}
          </div>
        </div>
      )}

      {/* No signals yet but live — show why */}
      {status === 'live' && signals.length === 0 && topSignal === null && (
        <div className="text-center text-xs text-ink-muted py-4 space-y-1">
          <div>No signals above confidence threshold yet.</div>
          <div className="opacity-60">
            Signals require genuine statistical edge — high base-probability contracts (UNDER 8, OVER 1) are filtered out.
          </div>
        </div>
      )}

      {/* Trade modal */}
      {tradeSignal && (
        <TradeModal
          signal={tradeSignal}
          timing={timing}
          onClose={() => setTradeSignal(null)}
        />
      )}
    </div>
  )
}
