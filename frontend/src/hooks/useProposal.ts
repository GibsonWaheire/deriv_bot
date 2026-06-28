import { useEffect, useState } from 'react'
import type { Signal } from '@/types'
import { useAuthStore } from '@/store/authStore'

export interface ProposalData {
  proposal_id: string
  ask_price: number
  payout: number
  payout_pct: number
  longcode: string
}

export function useProposal(signal: Signal | null, stake: number) {
  const { token } = useAuthStore()
  const [proposal, setProposal] = useState<ProposalData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!signal || !token || token === 'dev-token') {
      setProposal(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch('/api/trade/proposal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        symbol: signal.symbol,
        contract_type: signal.contract_type,
        barrier: signal.barrier,
        duration: signal.duration,
        stake,
      }),
    })
      .then(async r => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.detail || 'Proposal failed')
        return data as ProposalData
      })
      .then(data => { if (!cancelled) { setProposal(data); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false) } })

    return () => { cancelled = true }
  }, [signal?.symbol, signal?.contract_type, signal?.barrier, signal?.duration, stake, token])

  return { proposal, loading, error }
}
