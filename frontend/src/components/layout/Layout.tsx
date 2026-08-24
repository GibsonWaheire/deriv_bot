import { Outlet } from 'react-router-dom'
import { useEffect, useState, useCallback } from 'react'
import Topbar from './Topbar'
import Sidebar from './Sidebar'
import { DEFAULT_ON } from './Sidebar'
import { useAuthStore } from '@/store/authStore'
import type { ConnectionStatus } from '@/types'

export default function Layout() {
  const { token } = useAuthStore()
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([...DEFAULT_ON])
  const [histCount, setHistCount] = useState(4000)
  const [status, setStatus] = useState<ConnectionStatus>('offline')
  const [rtt, setRtt] = useState<number | null>(null)
  const [balance, setBalance] = useState<number | null>(null)

  function handleConnect() {
    window.dispatchEvent(
      new CustomEvent('dst:connect', { detail: { selectedSymbols, histCount } })
    )
  }

  function handleStop() {
    window.dispatchEvent(new CustomEvent('dst:stop'))
  }

  // Poll live balance from Deriv every 30s when logged in
  const fetchBalance = useCallback(async () => {
    if (!token || token === 'dev-token') return
    try {
      const res = await fetch('/api/trade/balance', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const data = await res.json()
      if (data.balance != null) setBalance(data.balance)
    } catch { /* ignore — balance will update next poll */ }
  }, [token])

  useEffect(() => {
    fetchBalance()
    const interval = setInterval(fetchBalance, 30_000)
    return () => clearInterval(interval)
  }, [fetchBalance])

  useEffect(() => {
    const onStatus = (e: Event) => setStatus((e as CustomEvent).detail as ConnectionStatus)
    const onRtt    = (e: Event) => setRtt((e as CustomEvent).detail as number)
    const onBal    = (e: Event) => setBalance((e as CustomEvent).detail as number)
    window.addEventListener('dst:status',  onStatus)
    window.addEventListener('dst:rtt',     onRtt)
    window.addEventListener('dst:balance', onBal)
    return () => {
      window.removeEventListener('dst:status',  onStatus)
      window.removeEventListener('dst:rtt',     onRtt)
      window.removeEventListener('dst:balance', onBal)
    }
  }, [])

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-surface">
      <Topbar
        rtt={rtt}
        balance={balance}
        status={status}
      />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          selectedSymbols={selectedSymbols}
          histCount={histCount}
          onSymbolsChange={setSelectedSymbols}
          onHistCountChange={setHistCount}
          onConnect={handleConnect}
          onStop={handleStop}
          connected={status === 'live' || status === 'connecting'}
        />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
