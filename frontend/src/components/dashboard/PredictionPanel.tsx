import { useEffect, useState } from 'react'
import type { Signal, TimingInfo } from '@/types'

const PLACE_WINDOW_SECS = 10

function getSteps(signal: Signal): string[] {
  const dur = `${signal.duration} tick${signal.duration !== 1 ? 's' : ''}`
  switch (signal.contract_type) {
    case 'DIGITMATCH':
      return [
        `Symbol: ${signal.name}`,
        'Contract: Digits → Matches/Differs',
        `Set last digit = ${signal.barrier} · Matches`,
        `Duration: ${dur}`,
        'Click BUY',
      ]
    case 'DIGITEVEN':
      return [`Symbol: ${signal.name}`, 'Contract: Digits → Even/Odd', 'Select Even', `Duration: ${dur}`, 'Click BUY']
    case 'DIGITODD':
      return [`Symbol: ${signal.name}`, 'Contract: Digits → Even/Odd', 'Select Odd', `Duration: ${dur}`, 'Click BUY']
    case 'DIGITOVER':
      return [`Symbol: ${signal.name}`, 'Contract: Digits → Over/Under', `Select Over ${signal.barrier}`, `Duration: ${dur}`, 'Click BUY']
    case 'DIGITUNDER':
      return [`Symbol: ${signal.name}`, 'Contract: Digits → Over/Under', `Select Under ${signal.barrier}`, `Duration: ${dur}`, 'Click BUY']
    case 'CALL':
      return [`Symbol: ${signal.name}`, 'Contract: Up/Down → Rise/Fall', 'Select Rise', `Duration: ${dur}`, 'Click BUY']
    case 'PUT':
      return [`Symbol: ${signal.name}`, 'Contract: Up/Down → Rise/Fall', 'Select Fall', `Duration: ${dur}`, 'Click BUY']
    default:
      return [`Symbol: ${signal.name}`, `Contract: ${signal.contract_type}`, `Duration: ${dur}`, 'Click BUY']
  }
}

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
  refreshesIn: number
}

export default function PredictionPanel({ signal, timing, timingAt, refreshesIn }: Props) {
  const [secsLeft, setSecsLeft] = useState<number>(PLACE_WINDOW_SECS)

  // 10-second manual placement countdown from when the signal fired
  useEffect(() => {
    const tick = () => {
      const elapsed = (Date.now() / 1000) - signal.fired_at
      setSecsLeft(Math.max(PLACE_WINDOW_SECS - elapsed, 0))
    }
    tick()
    const id = setInterval(tick, 100)
    return () => clearInterval(id)
  }, [signal.fired_at])

  const windowOpen = secsLeft > 0
  const urgency = secsLeft > 6 ? 'green' : secsLeft > 3 ? 'yellow' : 'red'
  const urgencyText = urgency === 'green' ? 'text-brand-green' : urgency === 'yellow' ? 'text-brand-yellow' : 'text-brand-red'
  const urgencyBorder = urgency === 'green' ? 'border-brand-green' : urgency === 'yellow' ? 'border-brand-yellow' : 'border-brand-red'
  const urgencyBg = urgency === 'green' ? 'bg-brand-green/5' : urgency === 'yellow' ? 'bg-brand-yellow/5' : 'bg-brand-red/5'

  const pct = (signal.confidence * 100).toFixed(1)
  const edgePct = ((signal.confidence - 0.5) * 100).toFixed(1)
  const labelColor = CONTRACT_COLOR[signal.contract_type] ?? 'text-ink'
  const gradeColor = GRADE_COLOR[signal.grade] ?? 'text-ink'

  const targetDisplay =
    signal.barrier
      ? signal.barrier
      : signal.contract_type === 'CALL'      ? '↑'
      : signal.contract_type === 'PUT'       ? '↓'
      : signal.contract_type === 'DIGITEVEN' ? 'EVEN'
      : signal.contract_type === 'DIGITODD'  ? 'ODD'
      : '~'

  return (
    <div className={`
      rounded-2xl border p-6 space-y-5 transition-all duration-300
      ${windowOpen ? `${urgencyBorder} ${urgencyBg}` : 'border-border bg-surface-2'}
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
        </div>
      </div>

      {/* Main prediction */}
      <div className="flex items-center gap-6">
        <div className={`text-7xl font-mono font-black leading-none ${labelColor}`}>
          {targetDisplay}
        </div>
        <div className="flex-1 space-y-3">
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

      {/* === 10-SECOND MANUAL PLACEMENT WINDOW === */}
      {windowOpen ? (
        <div className={`rounded-xl border ${urgencyBorder} ${urgencyBg} p-4 space-y-3`}>
          {/* Countdown row */}
          <div className="flex items-center gap-4">
            <div className="text-center shrink-0">
              <div className={`text-5xl font-mono font-black tabular-nums leading-none ${urgencyText}`}>
                {Math.ceil(secsLeft)}
              </div>
              <div className="text-[10px] text-ink-muted mt-0.5">seconds</div>
            </div>
            <div className="flex-1 space-y-1.5">
              <div className="text-[11px] font-bold uppercase tracking-widest text-ink-muted">
                Place on Deriv now
              </div>
              <div className="h-2 rounded-full bg-surface-4">
                <div
                  className={`h-2 rounded-full transition-all duration-100 ${
                    urgency === 'green' ? 'bg-brand-green' : urgency === 'yellow' ? 'bg-brand-yellow' : 'bg-brand-red'
                  }`}
                  style={{ width: `${(secsLeft / PLACE_WINDOW_SECS) * 100}%` }}
                />
              </div>
            </div>
          </div>

          {/* Step-by-step guide */}
          <div className="rounded-lg bg-surface-2/60 border border-border p-3 space-y-1.5">
            {getSteps(signal).map((step, i) => (
              <div key={i} className="flex items-start gap-2.5 text-xs">
                <span className={`shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold
                  ${i === getSteps(signal).length - 1
                    ? 'bg-brand-green/20 text-brand-green border border-brand-green/40'
                    : 'bg-surface-4 text-ink-muted border border-border'
                  }`}>
                  {i + 1}
                </span>
                <span className={i === getSteps(signal).length - 1 ? 'font-bold text-brand-green' : 'text-ink'}>
                  {step}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-surface-3 p-4 text-center space-y-1">
          <div className="text-xs font-semibold text-ink-muted">Window closed</div>
          <div className="text-[10px] text-ink-muted">
            Next analysis in <span className="text-ink font-semibold">{refreshesIn} ticks</span>
          </div>
        </div>
      )}

      {/* Timing bar */}
      {timing && (
        <div className="flex items-center justify-between text-[10px] text-ink-muted px-1">
          <span>RTT <span className="text-ink font-mono">{Math.round(timing.rtt_ms)}ms</span></span>
          <span>Interval <span className="text-ink font-mono">{Math.round(timing.tick_interval_ms)}ms</span></span>
          <span>
            Entry window{' '}
            <span className={`font-mono ${timing.entry_window_ms > 0 ? 'text-brand-green' : 'text-brand-red'}`}>
              {Math.round(timing.entry_window_ms)}ms
            </span>
          </span>
        </div>
      )}
    </div>
  )
}
