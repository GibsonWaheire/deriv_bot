import { useCallback, useEffect, useRef, useState } from 'react'
import type { Signal, TimingInfo, TickMessage } from '@/types'
import { useAuthStore } from '@/store/authStore'

export interface SignalsState {
  signals: Signal[]
  ticksBySymbol: Record<string, TickMessage[]>
  timing: TimingInfo | null
  status: 'offline' | 'connecting' | 'live' | 'error'
  rtt: number | null
  errorMsg: string | null
}

const INITIAL: SignalsState = {
  signals: [],
  ticksBySymbol: {},
  timing: null,
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
    if (!token) return
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    setState(s => ({ ...s, status: 'connecting', errorMsg: null }))

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(
      `${proto}//${window.location.host}/ws/signals?token=${encodeURIComponent(token)}`
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
        if (msg.type === 'signal') {
          setState(s => ({ ...s, signals: msg.data }))
        } else if (msg.type === 'tick') {
          const t: TickMessage = msg
          setState(s => ({
            ...s,
            ticksBySymbol: {
              ...s.ticksBySymbol,
              [t.symbol]: [
                ...(s.ticksBySymbol[t.symbol] ?? []).slice(-99),
                t,
              ],
            },
          }))
        } else if (msg.type === 'timing') {
          const { rtt_ms, tick_interval_ms, entry_window_ms, next_tick_in_ms } = msg
          setState(s => ({
            ...s,
            rtt: rtt_ms,
            timing: { rtt_ms, tick_interval_ms, entry_window_ms, next_tick_in_ms },
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
      // Auto-reconnect after 4s
      retryRef.current = setTimeout(() => {
        if (alive.current) connect()
      }, 4000)
    }
  }, [token])

  const disconnect = useCallback(() => {
    if (retryRef.current) clearTimeout(retryRef.current)
    wsRef.current?.close()
    wsRef.current = null
    setState(s => ({ ...s, status: 'offline' }))
  }, [])

  useEffect(() => {
    alive.current = true
    if (token) connect()
    return () => {
      alive.current = false
      disconnect()
    }
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  return { ...state, connect, disconnect }
}
