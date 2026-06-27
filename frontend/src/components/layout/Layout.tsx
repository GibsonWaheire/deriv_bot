import { Outlet } from 'react-router-dom'
import { useState } from 'react'
import Topbar from './Topbar'
import Sidebar from './Sidebar'
import { DEFAULT_ON } from './Sidebar'
import type { ConnectionStatus } from '@/types'

export default function Layout() {
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([...DEFAULT_ON])
  const [histCount, setHistCount] = useState(4000)
  const [status, setStatus] = useState<ConnectionStatus>('offline')
  const [rtt, setRtt] = useState<number | null>(null)
  const [tradeCount] = useState(0)

  function handleConnect() {
    setStatus('connecting')
    // Actual WS connection wired in Dashboard
    window.dispatchEvent(new CustomEvent('dst:connect', { detail: { selectedSymbols, histCount } }))
  }

  function handleStop() {
    setStatus('offline')
    window.dispatchEvent(new CustomEvent('dst:stop'))
  }

  // Listen for status/rtt updates from child pages
  useState(() => {
    const onStatus = (e: Event) => setStatus((e as CustomEvent).detail as ConnectionStatus)
    const onRtt = (e: Event) => setRtt((e as CustomEvent).detail as number)
    window.addEventListener('dst:status', onStatus)
    window.addEventListener('dst:rtt', onRtt)
    return () => {
      window.removeEventListener('dst:status', onStatus)
      window.removeEventListener('dst:rtt', onRtt)
    }
  })

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-surface">
      <Topbar
        rtt={rtt}
        status={status}
        tradeCount={tradeCount}
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
