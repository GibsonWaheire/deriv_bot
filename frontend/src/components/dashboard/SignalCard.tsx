import type { Signal } from '@/types'

const CONTRACT_BADGE: Record<string, { label: string; color: string }> = {
  DIGITMATCH:  { label: 'MATCH',  color: 'bg-brand-blue/15 text-brand-blue border-brand-blue/30' },
  DIGITEVEN:   { label: 'EVEN',   color: 'bg-brand-green/15 text-brand-green border-brand-green/30' },
  DIGITODD:    { label: 'ODD',    color: 'bg-brand-purple/15 text-brand-purple border-brand-purple/30' },
  DIGITOVER:   { label: 'OVER',   color: 'bg-brand-green/15 text-brand-green border-brand-green/30' },
  DIGITUNDER:  { label: 'UNDER',  color: 'bg-brand-red/15 text-brand-red border-brand-red/30' },
  CALL:        { label: 'RISE',   color: 'bg-brand-green/15 text-brand-green border-brand-green/30' },
  PUT:         { label: 'FALL',   color: 'bg-brand-red/15 text-brand-red border-brand-red/30' },
}

const GRADE_COLOR = { A: 'text-brand-green', B: 'text-brand-yellow' }

interface Props {
  rank: number
  signal: Signal
  onTrade: (signal: Signal) => void
}

export default function SignalCard({ rank, signal, onTrade }: Props) {
  const badge = CONTRACT_BADGE[signal.contract_type] ?? { label: signal.contract_type, color: 'bg-surface-4 text-ink-muted border-border' }
  const gradeColor = GRADE_COLOR[signal.grade] ?? 'text-ink-muted'
  const targetStr = signal.barrier || (signal.contract_type === 'CALL' ? '↑' : signal.contract_type === 'PUT' ? '↓' : '~')

  return (
    <div className="flex items-center gap-4 px-4 py-3 rounded-xl border border-border bg-surface-2 hover:bg-surface-3 transition-colors group">
      {/* Rank */}
      <span className="text-xs font-mono text-ink-muted w-4 shrink-0">#{rank}</span>

      {/* Badge */}
      <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider border shrink-0 ${badge.color}`}>
        {badge.label}
      </span>

      {/* Target */}
      <span className="text-lg font-mono font-bold text-ink w-8 shrink-0">{targetStr}</span>

      {/* Instrument */}
      <span className="text-xs text-ink-muted flex-1 truncate">{signal.name}</span>

      {/* Confidence + Grade */}
      <div className="text-right shrink-0">
        <span className="text-sm font-bold text-ink">{(signal.confidence * 100).toFixed(1)}%</span>
        <span className={`ml-1.5 text-xs font-bold ${gradeColor}`}>{signal.grade}</span>
      </div>

      {/* Duration */}
      <span className="text-[10px] text-ink-muted shrink-0">{signal.duration}t</span>

      {/* Trade button (shows on hover) */}
      <button
        onClick={() => onTrade(signal)}
        className="shrink-0 px-3 py-1 rounded-lg text-xs font-bold bg-brand-blue/10 text-brand-blue border border-brand-blue/20
          opacity-0 group-hover:opacity-100 transition-opacity hover:bg-brand-blue/20"
      >
        Trade
      </button>
    </div>
  )
}
