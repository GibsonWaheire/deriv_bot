import type { Signal } from '@/types'

const STRATEGY_LABEL: Record<string, string> = {
  digit_match: 'MATCH',
  even_odd: 'EVEN/ODD',
  rise_fall: 'RISE/FALL',
  over_under: 'OVER/UNDER',
}

const CONTRACT_BADGE: Record<string, { label: string; color: string }> = {
  DIGITMATCH:  { label: 'MATCH',  color: 'bg-brand-blue/20 text-brand-blue border-brand-blue/30' },
  DIGITEVEN:   { label: 'EVEN',   color: 'bg-brand-green/20 text-brand-green border-brand-green/30' },
  DIGITODD:    { label: 'ODD',    color: 'bg-brand-purple/20 text-brand-purple border-brand-purple/30' },
  DIGITOVER:   { label: 'OVER',   color: 'bg-brand-green/20 text-brand-green border-brand-green/30' },
  DIGITUNDER:  { label: 'UNDER',  color: 'bg-brand-red/20 text-brand-red border-brand-red/30' },
  CALL:        { label: 'RISE',   color: 'bg-brand-green/20 text-brand-green border-brand-green/30' },
  PUT:         { label: 'FALL',   color: 'bg-brand-red/20 text-brand-red border-brand-red/30' },
}

const GRADE_STYLE: Record<string, string> = {
  A: 'bg-brand-green/20 text-brand-green border-brand-green/40',
  B: 'bg-brand-yellow/20 text-brand-yellow border-brand-yellow/40',
}

interface Props {
  signal: Signal
  onTrade: (signal: Signal) => void
}

export default function SignalCard({ signal, onTrade }: Props) {
  const badge = CONTRACT_BADGE[signal.contract_type] ?? {
    label: signal.contract_type,
    color: 'bg-surface-4 text-ink-muted border-border',
  }
  const gradeStyle = GRADE_STYLE[signal.grade] ?? ''
  const isFresh = Date.now() / 1000 - signal.fired_at < 10  // < 10s old

  return (
    <div
      className={`
        relative flex-shrink-0 w-64 rounded-xl border bg-surface-2 p-4 space-y-3
        transition-all duration-300
        ${isFresh ? 'border-brand-blue/50 shadow-[0_0_12px_2px_rgba(61,158,255,0.15)]' : 'border-border'}
      `}
    >
      {/* Fresh indicator */}
      {isFresh && (
        <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-brand-blue animate-pulse" />
      )}

      {/* Top row: strategy badge + grade */}
      <div className="flex items-center gap-2">
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider border ${badge.color}`}>
          {badge.label}
        </span>
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${gradeStyle}`}>
          {signal.grade}
        </span>
        <span className="ml-auto text-xs text-ink-muted">{signal.name}</span>
      </div>

      {/* Target */}
      <div className="flex items-end gap-3">
        {signal.barrier ? (
          <span className="text-5xl font-mono font-bold text-ink leading-none">
            {signal.barrier}
          </span>
        ) : (
          <span className="text-2xl font-bold text-ink leading-none">
            {signal.contract_type === 'CALL' ? '↑ RISE' :
             signal.contract_type === 'PUT'  ? '↓ FALL' :
             signal.contract_type === 'DIGITEVEN' ? 'EVEN' : 'ODD'}
          </span>
        )}
        <div className="mb-1 space-y-0.5">
          <div className="text-xl font-semibold text-brand-green">
            {(signal.confidence * 100).toFixed(1)}%
          </div>
          <div className="text-xs text-ink-muted">
            {signal.duration} tick{signal.duration !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* AI Explanation */}
      {signal.explanation && (
        <p className="text-xs text-ink-dim leading-relaxed line-clamp-2">
          {signal.explanation}
        </p>
      )}

      {/* Edge bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-[10px] text-ink-muted">
          <span>Edge</span>
          <span className="text-brand-green">+{(signal.edge * 100).toFixed(1)}%</span>
        </div>
        <div className="h-1 rounded-full bg-surface-4">
          <div
            className="h-1 rounded-full bg-brand-green transition-all"
            style={{ width: `${Math.min(signal.edge * 200, 100)}%` }}
          />
        </div>
      </div>

      {/* TRADE button */}
      <button
        onClick={() => onTrade(signal)}
        className="w-full py-2 rounded-lg text-xs font-bold bg-brand-blue/15 text-brand-blue border border-brand-blue/30 hover:bg-brand-blue/25 active:scale-95 transition-all"
      >
        TRADE
      </button>
    </div>
  )
}
