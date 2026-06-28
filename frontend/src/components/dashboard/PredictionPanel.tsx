import { useEffect, useState } from 'react'
import type { Signal, TimingInfo } from '@/types'

const CONTRACT_LABEL: Record<string, string> = {
  DIGITMATCH:  'Digit Match',
  DIGITEVEN:   'Even',
  DIGITODD:    'Odd',
  DIGITOVER:   'Over',
  DIGITUNDER:  'Under',
  CALL:        'Rise',
  PUT:         'Fall',
}

const CONTRACT_COLOR: Record<string, string> = {
  DIGITMATCH:  'text-brand-blue',
  DIGITEVEN:   'text-brand-green',
  DIGITODD:    'text-brand-purple',
  DIGITOVER:   'text-brand-green',
  DIGITUNDER:  'text-brand-red',
  CALL:        'text-brand-green',
  PUT:         'text-brand-red',
}

const GRADE_COLOR = { A: 'text-brand-green', B: 'text-brand-yellow' }

interface Props {
  signal: Signal
  timing: TimingInfo | null
  timingAt: number
  onTrade: (signal: Signal) => void
}

export default function PredictionPanel({ signal, timing, timingAt, onTrade }: Props) {
  const [msLeft, setMsLeft] = useState<number | null>(null)
  const [windowOpen, setWindowOpen] = useState(false)

  // Live countdown to next tick
  useEffect(() => {
    if (!timing) return
    const tick = () => {
      const elapsed = Date.now() - timingAt
      const remaining = timing.next_tick_in_ms - elapsed
      setMsLeft(Math.max(remaining, 0))
      setWindowOpen(remaining <= 0 && elapsed < timing.tick_interval_ms)
    }
    tick()
    const id = setInterval(tick, 50)
    return () => clearInterval(id)
  }, [timing, timingAt])

  const pct = (signal.confidence * 100).toFixed(1)
  const edgePct = (signal.edge * 100).toFixed(1)
  const labelColor = CONTRACT_COLOR[signal.contract_type] ?? 'text-ink'
  const gradeColor = GRADE_COLOR[signal.grade] ?? 'text-ink'

  const targetDisplay =
    signal.barrier
      ? signal.barrier
      : signal.contract_type === 'CALL'   ? '↑'
      : signal.contract_type === 'PUT'    ? '↓'
      : signal.contract_type === 'DIGITEVEN' ? 'EVEN'
      : signal.contract_type === 'DIGITODD'  ? 'ODD'
      : '~'

  return (
    <div className={`
      rounded-2xl border p-6 space-y-5 transition-all duration-300
      ${windowOpen
        ? 'border-brand-green bg-brand-green/5 shadow-[0_0_24px_4px_rgba(0,212,160,0.12)]'
        : 'border-border bg-surface-2'}
    `}>

      {/* Label row */}
      <div className="flex items-center gap-3">
        <span className={`text-xs font-bold uppercase tracking-widest ${labelColor}`}>
          {CONTRACT_LABEL[signal.contract_type] ?? signal.contract_type}
        </span>
        <span className="text-xs text-ink-muted">·</span>
        <span className="text-xs text-ink-muted">{signal.name}</span>
        <div className="ml-auto flex items-center gap-2">
          <span className={`text-xs font-bold ${gradeColor}`}>Grade {signal.grade}</span>
          {windowOpen && (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-brand-green/20 text-brand-green border border-brand-green/40 animate-pulse">
              ENTRY OPEN
            </span>
          )}
        </div>
      </div>

      {/* Main prediction */}
      <div className="flex items-center gap-6">
        {/* Target */}
        <div className={`text-7xl font-mono font-black leading-none ${labelColor}`}>
          {targetDisplay}
        </div>

        {/* Stats */}
        <div className="flex-1 space-y-3">
          {/* Confidence bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-ink-muted">Confidence</span>
              <span className="font-bold text-ink">{pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-surface-4">
              <div
                className="h-2 rounded-full bg-gradient-to-r from-brand-blue to-brand-green transition-all duration-500"
                style={{ width: `${signal.confidence * 100}%` }}
              />
            </div>
          </div>

          {/* Edge */}
          <div className="flex gap-4 text-xs">
            <span className="text-ink-muted">
              Edge <span className="text-brand-green font-semibold">+{edgePct}%</span>
            </span>
            <span className="text-ink-muted">
              Duration <span className="text-ink font-semibold">{signal.duration} tick{signal.duration !== 1 ? 's' : ''}</span>
            </span>
          </div>
        </div>
      </div>

      {/* AI explanation */}
      {signal.explanation && (
        <p className="text-sm text-ink-dim leading-relaxed border-l-2 border-brand-blue/30 pl-3">
          {signal.explanation}
        </p>
      )}

      {/* Entry countdown */}
      <div className="rounded-xl bg-surface-3 border border-border p-4 flex items-center justify-between gap-4">
        <div className="text-center flex-1">
          <div className={`text-2xl font-mono font-bold tabular-nums ${windowOpen ? 'text-brand-green' : 'text-ink'}`}>
            {windowOpen
              ? 'NOW'
              : msLeft != null
              ? msLeft >= 1000
                ? `${(msLeft / 1000).toFixed(1)}s`
                : `${Math.round(msLeft)}ms`
              : '—'}
          </div>
          <div className="text-[10px] text-ink-muted mt-0.5">
            {windowOpen ? 'Entry window open' : 'Until next tick'}
          </div>
        </div>

        {timing && (
          <>
            <div className="w-px h-8 bg-border" />
            <div className="text-center flex-1">
              <div className="text-sm font-mono text-ink">{Math.round(timing.rtt_ms)}ms</div>
              <div className="text-[10px] text-ink-muted">RTT</div>
            </div>
            <div className="w-px h-8 bg-border" />
            <div className="text-center flex-1">
              <div className={`text-sm font-mono ${timing.entry_window_ms > 0 ? 'text-brand-green' : 'text-brand-red'}`}>
                {Math.round(timing.entry_window_ms)}ms
              </div>
              <div className="text-[10px] text-ink-muted">Window</div>
            </div>
            <div className="w-px h-8 bg-border" />
            <div className="text-center flex-1">
              <div className="text-sm font-mono text-ink">{Math.round(timing.tick_interval_ms)}ms</div>
              <div className="text-[10px] text-ink-muted">Interval</div>
            </div>
          </>
        )}
      </div>

      {/* TRADE button */}
      <button
        onClick={() => onTrade(signal)}
        className={`
          w-full py-3.5 rounded-xl text-sm font-bold tracking-wide transition-all duration-200 active:scale-95
          ${windowOpen
            ? 'bg-brand-green text-surface shadow-[0_0_16px_4px_rgba(0,212,160,0.3)] hover:bg-brand-green/90'
            : 'bg-brand-blue/15 text-brand-blue border border-brand-blue/30 hover:bg-brand-blue/25'}
        `}
      >
        {windowOpen ? '⚡ TRADE NOW' : 'TRADE'}
      </button>
    </div>
  )
}
