import { useCallback, useEffect, useRef, useState } from 'react'
import type { Signal, TimingInfo, Snapshot } from '@/types'
import { useAuthStore } from '@/store/authStore'

export interface SymbolSnapshot {
  signals: Signal[]
  tickCount: number
  refreshesIn: number
  updatedAt: number    // Date.now() when snapshot arrived
}

export interface SignalsState {
  // Best signal across all symbols (highest confidence)
  topSignal: Signal | null
  // Per-symbol snapshots (stable predictions)
  snapshots: Record<string, SymbolSnapshot>
  // Timing per symbol
  timing: Record<string, TimingInfo & { receivedAt: number }>
  status: 'offline' | 'connecting' | 'live' | 'error'
  rtt: number | null
  errorMsg: string | null
}

const INITIAL: SignalsState = {
  topSignal: null,
  snapshots: {},
  timing: {},
  status: 'offline',
  rtt: null,
  errorMsg: null,
}

export function useSignals() {
  const { token } = useAuthStore()
  const [state, setState] = useState<SignalsState>(INITIAL)
  const wsRef = useRef<WebSocket | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const alive = useRef(true)

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    setState(s => ({ ...s, status: 'connecting', errorMsg: null }))

    const wsToken = token || 'dev-token'
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(
      `${proto}//${window.location.host}/ws/signals?token=${encodeURIComponent(wsToken)}`
    )
    wsRef.current = ws

    ws.onopen = () => {
      if (!alive.current) return
      setState(s => ({ ...s, status: 'live', errorMsg: null }))
    }

    ws.onmessage = ({ data }) => {
      if (!alive.current) return
      try {
        const msg = JSON.parse(data)

        if (msg.type === 'snapshot') {
          const snap: Snapshot = msg
          setState(s => {
            const updated: Record<string, SymbolSnapshot> = {
              ...s.snapshots,
              [snap.symbol]: {
                signals: snap.signals,
                tickCount: snap.tick_count,
                refreshesIn: snap.refreshes_in,
                updatedAt: Date.now(),
              },
            }
            // Recalculate top signal across all symbols
            const all: Signal[] = Object.values(updated).flatMap(ss => ss.signals)
            all.sort((a, b) => b.confidence - a.confidence)
            return { ...s, snapshots: updated, topSignal: all[0] ?? null }
          })
        } else if (msg.type === 'digit_tick') {
          // Per-tick refresh for Markov-sensitive signals (DIGITMATCH, DIGITDIFF)
          setState(s => {
            const sym = msg.symbol
            const existing = s.snapshots[sym]
            if (!existing) return s
            const targetCt = msg.contract_type  // which contract type to update
            const updatedSignals = existing.signals.map((sig: any) =>
              sig.contract_type === targetCt
                ? { ...sig, barrier: msg.barrier, confidence: msg.confidence, edge: msg.edge, grade: msg.grade, tier: msg.tier, meta: msg.meta, fired_at: msg.fired_at }
                : sig
            ).sort((a: any, b: any) => b.confidence - a.confidence)
            const updated = { ...s.snapshots, [sym]: { ...existing, signals: updatedSignals } }
            const all = Object.values(updated).flatMap((ss: any) => ss.signals) as any[]
            all.sort((a, b) => b.confidence - a.confidence)
            return { ...s, snapshots: updated, topSignal: all[0] ?? null }
          })
        } else if (msg.type === 'timing') {
          setState(s => ({
            ...s,
            rtt: msg.rtt_ms,
            timing: {
              ...s.timing,
              [msg.symbol]: {
                rtt_ms: msg.rtt_ms,
                tick_interval_ms: msg.tick_interval_ms,
                entry_window_ms: msg.entry_window_ms,
                next_tick_in_ms: msg.next_tick_in_ms,
                receivedAt: Date.now(),
              },
            },
          }))
        } else if (msg.type === 'ping') {
          ws.send('ping')
        }
      } catch { /* ignore parse errors */ }
    }

    ws.onerror = () => {
      if (!alive.current) return
      setState(s => ({ ...s, status: 'error', errorMsg: 'WebSocket error' }))
    }

    ws.onclose = (e) => {
      if (!alive.current) return
      if (e.code === 4001) {
        setState(s => ({ ...s, status: 'error', errorMsg: 'Unauthorized — re-login required' }))
        return
      }
      setState(s => ({ ...s, status: 'offline' }))
      retryRef.current = setTimeout(() => {
        if (alive.current) connect()
      }, 4000)
    }
  }, [token]) // token used as fallback — reconnect if real login happens

  const disconnect = useCallback(() => {
    if (retryRef.current) clearTimeout(retryRef.current)
    wsRef.current?.close()
    wsRef.current = null
    setState(INITIAL)
  }, [])

  // Do NOT auto-connect — only connect when explicitly called
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      disconnect()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return { ...state, connect, disconnect }
}
