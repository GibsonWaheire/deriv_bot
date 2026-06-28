import { useEffect, useState } from 'react'
import type { Signal, TimingInfo } from '@/types'
import { useProposal } from '@/hooks/useProposal'
import { useTradeExecution } from '@/hooks/useTradeExecution'

const STAKES = [1, 5, 10, 25]

const CONTRACT_LABEL: Record<string, string> = {
  DIGITMATCH: 'Digit Match', DIGITEVEN: 'Even', DIGITODD: 'Odd',
  DIGITOVER: 'Over', DIGITUNDER: 'Under', CALL: 'Rise', PUT: 'Fall',
}

interface Props {
  signal: Signal
  timing: TimingInfo | null
  onClose: () => void
}

export default function TradeModal({ signal, timing, onClose }: Props) {
  const [stake, setStake] = useState(10)
  const [customStake, setCustomStake] = useState('')
  const [useCustom, setUseCustom] = useState(false)

  const activeStake = useCustom ? Number(customStake) || 10 : stake
  const { proposal, loading: propLoading } = useProposal(signal, activeStake)
  const { phase, result, error, buy, reset } = useTradeExecution()

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function handleBuy() {
    if (!proposal) return
    buy(proposal.proposal_id, proposal.ask_price, timing ? {
      rtt_ms: timing.rtt_ms,
      tick_interval_ms: timing.tick_interval_ms,
    } : undefined)
  }

  function handleClose() {
    reset()
    onClose()
  }

  const settled = phase === 'open' || phase === 'settled'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div className="relative w-full max-w-sm mx-4 rounded-2xl border border-border bg-surface-2 p-6 space-y-5 shadow-2xl">
        {/* Close */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 text-ink-muted hover:text-ink transition-colors text-lg leading-none"
        >
          ×
        </button>

        {/* Header */}
        <div>
          <div className="text-xs text-ink-muted mb-1">{signal.name}</div>
          <div className="flex items-center gap-3">
            <span className="text-3xl font-mono font-bold text-ink">
              {signal.barrier || (signal.contract_type === 'CALL' ? '↑' : signal.contract_type === 'PUT' ? '↓' : '~')}
            </span>
            <div>
              <div className="text-sm font-semibold text-ink">
                {CONTRACT_LABEL[signal.contract_type] ?? signal.contract_type}
              </div>
              <div className="text-xs text-ink-muted">
                {signal.duration} tick{signal.duration !== 1 ? 's' : ''} · Grade {signal.grade}
              </div>
            </div>
            <div className="ml-auto text-right">
              <div className="text-lg font-bold text-brand-green">
                {(signal.confidence * 100).toFixed(1)}%
              </div>
              <div className="text-[10px] text-ink-muted">confidence</div>
            </div>
          </div>
        </div>

        {/* AI explanation */}
        {signal.explanation && (
          <p className="text-xs text-ink-dim leading-relaxed border-l-2 border-brand-blue/30 pl-3">
            {signal.explanation}
          </p>
        )}

        {/* Stake selector */}
        {!settled && (
          <div className="space-y-2">
            <div className="text-xs text-ink-muted">Stake</div>
            <div className="flex gap-2">
              {STAKES.map(s => (
                <button
                  key={s}
                  onClick={() => { setStake(s); setUseCustom(false) }}
                  className={`flex-1 py-1.5 rounded text-xs font-semibold border transition-colors ${
                    !useCustom && stake === s
                      ? 'bg-brand-blue/25 text-brand-blue border-brand-blue/50'
                      : 'bg-surface-4 text-ink-muted border-border hover:text-ink'
                  }`}
                >
                  ${s}
                </button>
              ))}
              <button
                onClick={() => setUseCustom(true)}
                className={`flex-1 py-1.5 rounded text-xs font-semibold border transition-colors ${
                  useCustom
                    ? 'bg-brand-blue/25 text-brand-blue border-brand-blue/50'
                    : 'bg-surface-4 text-ink-muted border-border hover:text-ink'
                }`}
              >
                Custom
              </button>
            </div>
            {useCustom && (
              <input
                type="number"
                value={customStake}
                onChange={e => setCustomStake(e.target.value)}
                placeholder="Enter amount"
                className="w-full px-3 py-1.5 rounded border border-border bg-surface-4 text-ink text-xs focus:outline-none focus:border-brand-blue"
                autoFocus
              />
            )}
          </div>
        )}

        {/* Live payout */}
        {!settled && (
          <div className="rounded-lg bg-surface-4 border border-border p-3 flex items-center justify-between">
            <div>
              <div className="text-xs text-ink-muted">Stake → Payout</div>
              {propLoading ? (
                <div className="text-sm text-ink-muted">Fetching quote…</div>
              ) : proposal ? (
                <div className="text-sm font-semibold text-ink">
                  ${proposal.ask_price.toFixed(2)}{' '}
                  <span className="text-ink-muted">→</span>{' '}
                  <span className="text-brand-green">${proposal.payout.toFixed(2)}</span>
                </div>
              ) : (
                <div className="text-xs text-ink-muted">Real login required for live quote</div>
              )}
            </div>
            {proposal && (
              <div className="text-right">
                <div className="text-lg font-bold text-brand-green">+{proposal.payout_pct.toFixed(1)}%</div>
                <div className="text-[10px] text-ink-muted">payout</div>
              </div>
            )}
          </div>
        )}

        {/* Timing */}
        {timing && !settled && (
          <div className="flex gap-4 text-xs text-ink-muted">
            <span>RTT <span className="text-ink">{timing.rtt_ms.toFixed(0)}ms</span></span>
            <span>Interval <span className="text-ink">{timing.tick_interval_ms.toFixed(0)}ms</span></span>
            <span>Window <span className={timing.entry_window_ms > 0 ? 'text-brand-green' : 'text-brand-red'}>
              {timing.entry_window_ms.toFixed(0)}ms
            </span></span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="text-xs text-brand-red bg-brand-red/10 border border-brand-red/20 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {/* Result after buy */}
        {result && (
          <div className="rounded-lg bg-brand-green/10 border border-brand-green/30 p-3 space-y-1">
            <div className="text-xs font-semibold text-brand-green">Trade opened</div>
            <div className="text-xs text-ink-muted">
              Contract #{result.contract_id} · Paid ${result.buy_price.toFixed(2)} · Payout ${result.payout.toFixed(2)}
            </div>
            <div className="text-xs text-ink-muted">
              Balance after: ${result.balance_after.toFixed(2)}
            </div>
          </div>
        )}

        {/* Action */}
        {!settled ? (
          <button
            onClick={handleBuy}
            disabled={phase === 'pending' || !proposal}
            className="w-full py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-50
              bg-brand-green/15 text-brand-green border border-brand-green/30
              hover:bg-brand-green/25 active:scale-95"
          >
            {phase === 'pending' ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-3 h-3 border-2 border-brand-green border-t-transparent rounded-full animate-spin" />
                Timing entry…
              </span>
            ) : 'Place Trade'}
          </button>
        ) : (
          <button
            onClick={handleClose}
            className="w-full py-3 rounded-xl text-sm font-bold bg-surface-4 text-ink border border-border hover:bg-surface-5 transition-colors"
          >
            Close
          </button>
        )}
      </div>
    </div>
  )
}
