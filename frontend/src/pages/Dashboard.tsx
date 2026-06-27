export default function Dashboard() {
  return (
    <div className="p-6 space-y-6">
      <div className="text-ink-muted text-sm">
        Connect an instrument from the sidebar to begin live signal analysis.
      </div>

      {/* Signal tray placeholder */}
      <div className="rounded-lg bg-surface-2 border border-border p-4">
        <div className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3">Top Signals</div>
        <div className="text-ink-muted text-sm">Analyzing historical data…</div>
      </div>

      {/* Card grid placeholder */}
      <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
        <div className="text-4xl text-ink-muted">◎</div>
        <p className="text-ink-muted text-sm">Select instruments and click <span className="text-ink font-medium">Connect &amp; Analyze</span></p>
        <p className="text-ink-muted text-xs">
          The app automatically fetches thousands of real historical ticks,<br />
          analyzes patterns, and shows you which strategy to trade — right now.
        </p>
      </div>
    </div>
  )
}
