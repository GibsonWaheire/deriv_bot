import { useEffect, useState } from 'react'
import type { Signal } from '@/types'
import { useSignals } from '@/hooks/useSignals'
import PredictionPanel from '@/components/dashboard/PredictionPanel'
import SignalCard from '@/components/dashboard/SignalCard'
import TradeModal from '@/components/dashboard/TradeModal'

export default function Dashboard() {
  const { topSignal, snapshots, timing, status, rtt, connect, disconnect } = useSignals()
  const [tradeSignal, setTradeSignal] = useState<Signal | null>(null)
  const [manuallyConnected, setManuallyConnected] = useState(false)

  // Propagate status + rtt to Layout topbar via events
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('dst:status', { detail: status }))
  }, [status])

  useEffect(() => {
    if (rtt != null) window.dispatchEvent(new CustomEvent('dst:rtt', { detail: rtt }))
  }, [rtt])

  // Listen for sidebar Connect / Stop buttons
  useEffect(() => {
    const onConnect = () => { setManuallyConnected(true); connect() }
    const onStop    = () => { setManuallyConnected(false); disconnect() }
    window.addEventListener('dst:connect', onConnect)
    window.addEventListener('dst:stop',    onStop)
    return () => {
      window.removeEventListener('dst:connect', onConnect)
      window.removeEventListener('dst:stop',    onStop)
    }
  }, [connect, disconnect])

  // All signals across all symbols, sorted by confidence
  const allSignals: Signal[] = Object.values(snapshots)
    .flatMap(s => s.signals)
    .sort((a, b) => b.confidence - a.confidence)

  const queueSignals = allSignals.slice(1)

  // The timing for the top signal's symbol
  const topTiming = topSignal ? (timing[topSignal.symbol] ?? null) : null
  const topTimingAt = topTiming ? (topTiming as any).receivedAt ?? 0 : 0

  // Snapshot metadata for the top signal
  const topSnap = topSignal ? snapshots[topSignal.symbol] : null

  return (
    <div className="p-5 space-y-5 min-h-full">

      {/* Error banner */}
      {status === 'error' && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand-red/10 border border-brand-red/25 text-brand-red text-xs">
          Connection error — check the sidebar and reconnect.
        </div>
      )}

      {/* === NOT CONNECTED === */}
      {!manuallyConnected && status === 'offline' && (
        <div className="rounded-2xl border border-border bg-surface-2 p-12 flex flex-col items-center text-center gap-4">
          <div className="text-5xl text-ink-muted">◎</div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-ink">Ready to analyze</p>
            <p className="text-xs text-ink-muted">
              Click <span className="text-brand-green font-semibold">Connect &amp; Analyze</span> in the sidebar
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-left mt-2 max-w-xs">
            {[
              'Loads 1,000 real ticks per instrument',
              'Runs Markov + gap + streak analysis',
              'Produces stable predictions (refresh every 50 ticks)',
              'Signals only fire on genuine statistical edge',
            ].map(t => (
              <div key={t} className="flex gap-2 text-xs text-ink-muted">
                <span className="text-brand-green shrink-0">✓</span>
                <span>{t}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* === CONNECTING / LOADING === */}
      {(status === 'connecting' || (status === 'live' && allSignals.length === 0)) && (
        <div className="rounded-2xl border border-border bg-surface-2 p-10 flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-2 border-brand-blue border-t-transparent rounded-full animate-spin" />
          <div className="text-sm text-ink-muted text-center">
            {status === 'connecting'
              ? 'Connecting to Deriv…'
              : 'Loading 1,000 ticks per symbol and computing predictions…'}
          </div>
          <div className="text-xs text-ink-muted opacity-50">
            First snapshot appears within a few seconds
          </div>
        </div>
      )}

      {/* === HERO PREDICTION === */}
      {topSignal && (
        <div className="space-y-1.5">
          {/* Snapshot freshness */}
          {topSnap && (
            <div className="flex items-center justify-between px-1 text-[10px] text-ink-muted">
              <span>
                Best prediction across {Object.keys(snapshots).length} instrument{Object.keys(snapshots).length !== 1 ? 's' : ''}
              </span>
              <span>
                Analysis refreshes in{' '}
                <span className="text-ink font-semibold">{topSnap.refreshesIn} ticks</span>
                {' '}· {topSnap.tickCount} ticks analyzed
              </span>
            </div>
          )}
          <PredictionPanel
            signal={topSignal}
            timing={topTiming}
            timingAt={topTimingAt}
            onTrade={setTradeSignal}
          />
        </div>
      )}

      {/* === SIGNAL QUEUE === */}
      {queueSignals.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <span className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
              Other Opportunities
            </span>
            <span className="text-[10px] text-ink-muted">
              — stable until next refresh
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

      {/* === LIVE — no signals yet === */}
      {status === 'live' && allSignals.length === 0 && Object.keys(snapshots).length > 0 && (
        <div className="text-center text-xs text-ink-muted py-4 space-y-1">
          <div>No signals above confidence threshold in this window.</div>
          <div className="opacity-60">
            The engine only signals on genuine edge — high-base-probability contracts (UNDER 8, OVER 1) are excluded.
            Analysis refreshes every 50 ticks.
          </div>
        </div>
      )}

      {/* Trade modal */}
      {tradeSignal && (
        <TradeModal
          signal={tradeSignal}
          timing={topTiming}
          onClose={() => setTradeSignal(null)}
        />
      )}
    </div>
  )
}
