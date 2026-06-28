import { useState } from 'react'
import type { TimingInfo } from '@/types'
import { useAuthStore } from '@/store/authStore'

export type TradePhase = 'idle' | 'pending' | 'open' | 'settled'

export interface TradeResult {
  contract_id: number
  buy_price: number
  payout: number
  purchase_time: number
  balance_after: number
  transaction_id: number
}

export function useTradeExecution() {
  const { token } = useAuthStore()
  const [phase, setPhase] = useState<TradePhase>('idle')
  const [result, setResult] = useState<TradeResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function buy(
    proposalId: string,
    price: number,
    timing?: Pick<TimingInfo, 'rtt_ms' | 'tick_interval_ms'> & { last_tick_epoch?: number }
  ) {
    if (!token || token === 'dev-token') {
      setError('Real Deriv login required to place trades')
      return
    }
    setPhase('pending')
    setError(null)
    try {
      const resp = await fetch('/api/trade/buy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          proposal_id: proposalId,
          price,
          ...(timing ?? {}),
        }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.detail || 'Buy failed')
      setResult(data as TradeResult)
      setPhase('open')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Buy failed')
      setPhase('idle')
    }
  }

  function reset() {
    setPhase('idle')
    setResult(null)
    setError(null)
  }

  return { phase, result, error, buy, reset }
}
