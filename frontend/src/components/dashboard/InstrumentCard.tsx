import type { Signal, TickMessage } from '@/types'

// 10 distinct colors per digit
const DIGIT_BG = [
  'bg-ink-muted/60',        // 0
  'bg-brand-blue/50',       // 1
  'bg-brand-blue',          // 2
  'bg-brand-green',         // 3
  'bg-brand-green/60',      // 4
  'bg-brand-yellow',        // 5
  'bg-brand-yellow/60',     // 6
  'bg-brand-red/60',        // 7
  'bg-brand-red',           // 8
  'bg-brand-purple',        // 9
]

const CONTRACT_SHORT: Record<string, string> = {
  DIGITMATCH: 'MATCH', DIGITEVEN: 'EVEN', DIGITODD: 'ODD',
  DIGITOVER: 'OVER', DIGITUNDER: 'UNDER', CALL: 'RISE', PUT: 'FALL',
}

interface Props {
  symbol: string
  name: string
  ticks: TickMessage[]
  signals: Signal[]
  rtt: number | null
}

export default function InstrumentCard({ symbol, name, ticks, signals, rtt }: Props) {
  const recent = ticks.slice(-20)
  const last = ticks[ticks.length - 1]
  const topSignal = signals[0] ?? null

  // Even/odd streak
  let streak = 0
  let streakType = ''
  if (recent.length > 0) {
    const lastClass = recent[recent.length - 1].digit % 2 === 0 ? 'even' : 'odd'
    streakType = lastClass
    for (let i = recent.length - 1; i >= 0; i--) {
      const c = recent[i].digit % 2 === 0 ? 'even' : 'odd'
      if (c === lastClass) streak++
      else break
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface-2 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-ink">{name}</div>
          <div className="text-[10px] text-ink-muted font-mono">{symbol}</div>
        </div>
        <div className="text-right space-y-0.5">
          {last && (
            <div className="text-xs font-mono text-ink">{last.price.toFixed(2)}</div>
          )}
          {rtt != null && (
            <div className="text-[10px] text-ink-muted">{rtt.toFixed(0)}ms RTT</div>
          )}
        </div>
      </div>

      {/* Digit strip — last 20 */}
      <div>
        <div className="text-[10px] text-ink-muted mb-1.5">Last {recent.length} digits</div>
        <div className="flex gap-1 flex-wrap">
          {recent.length === 0 ? (
            <div className="text-xs text-ink-muted">Loading…</div>
          ) : (
            recent.map((t, i) => (
              <div
                key={i}
                className={`
                  w-6 h-6 rounded flex items-center justify-center
                  text-[10px] font-bold text-surface font-mono
                  ${DIGIT_BG[t.digit]}
                  ${i === recent.length - 1 ? 'ring-1 ring-white/40' : ''}
                `}
              >
                {t.digit}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Even/Odd streak */}
      {streak > 0 && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-ink-muted">Streak</span>
          <span className={`font-semibold ${streakType === 'even' ? 'text-brand-green' : 'text-brand-purple'}`}>
            {streakType.toUpperCase()} ×{streak}
          </span>
        </div>
      )}

      {/* Top signal for this symbol */}
      {topSignal ? (
        <div className="flex items-center justify-between rounded-lg bg-surface-4 border border-border px-3 py-2">
          <div className="text-xs">
            <span className="text-ink-muted">Top signal: </span>
            <span className="font-semibold text-ink">
              {CONTRACT_SHORT[topSignal.contract_type] ?? topSignal.contract_type}
              {topSignal.barrier ? ` ${topSignal.barrier}` : ''}
            </span>
          </div>
          <div className="text-xs font-semibold text-brand-green">
            {(topSignal.confidence * 100).toFixed(1)}%
            <span className="ml-1 text-[10px] text-ink-muted font-normal">
              {topSignal.grade}
            </span>
          </div>
        </div>
      ) : (
        <div className="text-xs text-ink-muted">No signals yet</div>
      )}
    </div>
  )
}
