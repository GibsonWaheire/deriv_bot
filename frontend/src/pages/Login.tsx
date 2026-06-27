import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'

const APP_ID = import.meta.env.VITE_DERIV_APP_ID || '1089'
const DERIV_OAUTH_URL = `https://oauth.deriv.com/oauth2/authorize?app_id=${APP_ID}&l=en`

export default function Login() {
  const { isLoggedIn } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    if (isLoggedIn) navigate('/dashboard', { replace: true })
  }, [isLoggedIn, navigate])

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-8">
        {/* Brand */}
        <div className="space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-brand-blue/15 text-brand-blue font-mono font-bold text-2xl border border-brand-blue/30">
            DST
          </div>
          <h1 className="text-3xl font-bold text-ink">Digit Strategy Terminal</h1>
          <p className="text-ink-muted">
            Real-time signal analysis for Deriv AI Synthetic indices.
            Connect your Deriv account to start trading smarter.
          </p>
        </div>

        {/* Features */}
        <div className="grid grid-cols-2 gap-3 text-left">
          {[
            { icon: '◎', label: 'Live tick stream from Deriv' },
            { icon: '⟨⟩', label: 'Digit Match Markov signals' },
            { icon: '↑↓', label: 'Rise / Fall & Even / Odd' },
            { icon: '⊙', label: 'Over / Under threshold analysis' },
          ].map(({ icon, label }) => (
            <div key={label} className="flex items-start gap-2 p-3 rounded-lg bg-surface-3 border border-border">
              <span className="text-brand-blue mt-0.5">{icon}</span>
              <span className="text-xs text-ink">{label}</span>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="space-y-3">
          <a
            href={DERIV_OAUTH_URL}
            className="block w-full py-3 rounded-lg bg-brand-blue text-surface font-semibold text-sm hover:bg-brand-blue/90 transition-colors"
          >
            Sign in with Deriv
          </a>
          <p className="text-xs text-ink-muted">
            Don't have an account?{' '}
            <a
              href="https://track.deriv.com/_AFFILIATE_ID_/1/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-blue hover:underline"
            >
              Sign up free →
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
