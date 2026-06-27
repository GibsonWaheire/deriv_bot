export interface User {
  id: string
  deriv_account_id: string
  email: string
  currency: string
  country: string
  created_at: string
}

export interface Signal {
  symbol: string
  name: string
  strategy: 'digit_match' | 'even_odd' | 'rise_fall' | 'over_under'
  digit?: number
  label: string
  prob: number
  grade: 'A' | 'B' | 'C'
  edge: number
  fired_at: number
}

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
