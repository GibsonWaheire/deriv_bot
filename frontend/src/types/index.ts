export interface User {
  deriv_account_id: string
  email: string
  currency: string
  country: string
  balance?: number
}

export interface Signal {
  symbol: string
  name: string
  strategy: 'digit_match' | 'even_odd' | 'rise_fall' | 'over_under'
  contract_type: string        // DIGITMATCH | DIGITEVEN | CALL | DIGITOVER …
  barrier: string              // digit string, or "" for even/odd/rise/fall
  duration: number             // ticks
  confidence: number           // 0–1
  edge: number                 // confidence − 0.5
  grade: 'A' | 'B'
  explanation: string          // AI-generated 2-sentence explanation
  meta: Record<string, unknown>
  fired_at: number
}

export interface TimingInfo {
  rtt_ms: number
  tick_interval_ms: number
  entry_window_ms: number
  next_tick_in_ms: number
}

export interface TickMessage {
  type: 'tick'
  symbol: string
  digit: number
  price: number
  epoch: number
}

export interface Snapshot {
  symbol: string
  signals: Signal[]
  tick_count: number
  refreshes_in: number   // ticks until next analysis refresh
}

export type WsMessage =
  | { type: 'snapshot' } & Snapshot
  | TickMessage
  | ({ type: 'timing'; symbol: string } & TimingInfo)
  | { type: 'ping' }
  | { type: 'pong' }

export interface Trade {
  id: string
  symbol: string
  strategy: string
  label: string
  prob: number
  outcome: 'win' | 'loss' | 'skip'
  traded_at: string
}

export type ConnectionStatus = 'offline' | 'connecting' | 'live' | 'error'
