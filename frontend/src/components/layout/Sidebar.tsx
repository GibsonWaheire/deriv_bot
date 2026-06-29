import { Link, useLocation } from 'react-router-dom'

const INSTRUMENTS = [
  { value: 'R_10',    label: 'Vol 10' },
  { value: 'R_25',    label: 'Vol 25' },
  { value: 'R_50',    label: 'Vol 50' },
  { value: 'R_75',    label: 'Vol 75' },
  { value: 'R_100',   label: 'Vol 100' },
  { value: '1HZ10V',  label: '1s-10' },
  { value: '1HZ50V',  label: '1s-50' },
  { value: '1HZ100V', label: '1s-100' },
  { value: 'JD10',    label: 'Jump 10' },
  { value: 'JD50',    label: 'Jump 50' },
  { value: 'JD100',   label: 'Jump 100' },
]

const DEFAULT_ON = new Set(['R_50', 'R_100', '1HZ100V'])

interface SidebarProps {
  selectedSymbols: string[]
  histCount: number
  onSymbolsChange: (syms: string[]) => void
  onHistCountChange: (n: number) => void
  onConnect: () => void
  onStop: () => void
  connected: boolean
}

export default function Sidebar({
  selectedSymbols,
  histCount,
  onSymbolsChange,
  onHistCountChange,
  onConnect,
  onStop,
  connected,
}: SidebarProps) {
  const location = useLocation()

  function toggle(sym: string) {
    onSymbolsChange(
      selectedSymbols.includes(sym)
        ? selectedSymbols.filter(s => s !== sym)
        : [...selectedSymbols, sym]
    )
  }

  return (
    <aside className="w-52 shrink-0 bg-surface-2 border-r border-border flex flex-col overflow-y-auto">
      {/* Nav */}
      <nav className="p-2 border-b border-border">
        {[
          { to: '/dashboard', label: 'Dashboard' },
          { to: '/journal', label: 'Journal' },
          { to: '/auto', label: 'Auto Bot' },
          { to: '/admin/affiliate', label: 'Affiliate' },
          { to: '/settings', label: 'Settings' },
        ].map(({ to, label }) => (
          <Link
            key={to}
            to={to}
            className={`flex items-center px-3 py-1.5 rounded text-sm mb-0.5 transition-colors ${
              location.pathname === to
                ? 'bg-brand-blue/15 text-brand-blue'
                : 'text-ink-muted hover:text-ink hover:bg-surface-4'
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>

      {/* Connection block */}
      <div className="p-3 border-b border-border space-y-3">
        <div className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">Connection</div>

        <div className="space-y-1">
          <label className="text-xs text-ink-muted">History Depth</label>
          <select
            value={histCount}
            onChange={e => onHistCountChange(Number(e.target.value))}
            className="w-full px-2 py-1.5 rounded border border-border bg-surface-4 text-ink text-xs focus:outline-none focus:border-border-2"
          >
            <option value={2000}>2,000 ticks</option>
            <option value={4000}>4,000 ticks</option>
            <option value={5000}>5,000 ticks (max)</option>
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-ink-muted">Instruments</label>
          <div className="space-y-0.5">
            {INSTRUMENTS.map(({ value, label }) => (
              <label key={value} className="flex items-center gap-2 px-1 py-0.5 rounded hover:bg-surface-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedSymbols.includes(value)}
                  onChange={() => toggle(value)}
                  className="accent-brand-blue w-3.5 h-3.5"
                />
                <span className="text-xs text-ink">{label}</span>
              </label>
            ))}
          </div>
        </div>

        {connected ? (
          <button
            onClick={onStop}
            className="w-full py-1.5 rounded text-xs font-semibold bg-brand-red/15 text-brand-red border border-brand-red/30 hover:bg-brand-red/25 transition-colors"
          >
            ■ Stop
          </button>
        ) : (
          <button
            onClick={onConnect}
            className="w-full py-1.5 rounded text-xs font-semibold bg-brand-green/15 text-brand-green border border-brand-green/30 hover:bg-brand-green/25 transition-colors"
          >
            ▶ Connect &amp; Analyze
          </button>
        )}
      </div>
    </aside>
  )
}

export { DEFAULT_ON }
