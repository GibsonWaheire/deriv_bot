import { useEffect, useState } from 'react'
import type { Signal } from '@/types'
import { useSignals } from '@/hooks/useSignals'
import SignalTray from '@/components/dashboard/SignalTray'
import InstrumentCard from '@/components/dashboard/InstrumentCard'
import TradeModal from '@/components/dashboard/TradeModal'

const SYMBOL_NAMES: Record<string, string> = {
  '1HZ100V': 'Volatility 100 (1s)',
  '1HZ10V':  'Volatility 10 (1s)',
  'R_100':   'Volatility 100',
  'R_50':    'Volatility 50',
  'R_10':    'Volatility 10',
  'R_25':    'Volatility 25',
}

export default function Dashboard() {
  const { signals, ticksBySymbol, timing, status, rtt, errorMsg } = useSignals()
  const [tradeSignal, setTradeSignal] = useState<Signal | null>(null)

  // Propagate status + rtt up to Layout via custom events
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('dst:status', { detail: status }))
  }, [status])

  useEffect(() => {
    if (rtt != null) {
      window.dispatchEvent(new CustomEvent('dst:rtt', { detail: rtt }))
    }
  }, [rtt])

  // Unique symbols with live ticks
  const activeSymbols = Object.keys(ticksBySymbol).filter(
    s => (ticksBySymbol[s]?.length ?? 0) > 0
  )

  return (
    <div className="p-5 space-y-6 min-h-full">

      {/* Status banner */}
      {status === 'error' && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand-red/10 border border-brand-red/25 text-brand-red text-xs">
          <span className="font-semibold">Connection error</span>
          {errorMsg && <span className="text-brand-red/70">— {errorMsg}</span>}
        </div>
      )}

      {/* Signal tray */}
      <SignalTray signals={signals} status={status} onTrade={setTradeSignal} />

      {/* Instrument grid */}
      <div className="space-y-2">
        <div className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider px-1">
          Instruments
          {activeSymbols.length > 0 && (
            <span className="ml-2 text-ink-dim normal-case">
              {activeSymbols.length} live
            </span>
          )}
        </div>

        {activeSymbols.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
            <div className="text-4xl text-ink-muted">◎</div>
            {status === 'connecting' ? (
              <>
                <div className="w-6 h-6 border-2 border-brand-blue border-t-transparent rounded-full animate-spin" />
                <p className="text-ink-muted text-sm">Connecting to Deriv…</p>
              </>
            ) : status === 'live' ? (
              <>
                <div className="w-6 h-6 border-2 border-brand-green border-t-transparent rounded-full animate-spin" />
                <p className="text-ink-muted text-sm">Loading tick history…</p>
              </>
            ) : (
              <>
                <p className="text-ink-muted text-sm">
                  Click <span className="text-ink font-medium">Connect &amp; Analyze</span> in the sidebar
                </p>
                <p className="text-ink-muted text-xs">
                  Fetches 5,000 real ticks, runs Markov analysis, and fires live signals.
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {activeSymbols.map(symbol => (
              <InstrumentCard
                key={symbol}
                symbol={symbol}
                name={SYMBOL_NAMES[symbol] ?? symbol}
                ticks={ticksBySymbol[symbol] ?? []}
                signals={signals.filter(s => s.symbol === symbol)}
                rtt={rtt}
              />
            ))}
          </div>
        )}
      </div>

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
