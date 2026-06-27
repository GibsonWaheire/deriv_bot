import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { buildLoginUrl, buildSignupUrl } from '@/lib/pkce'

const IS_DEV = import.meta.env.DEV
const CLIENT_ID = import.meta.env.VITE_DERIV_CLIENT_ID || ''
const REDIRECT_URI = import.meta.env.VITE_DERIV_REDIRECT_URI || 'http://localhost:5173/auth/callback'
const AFFILIATE_ID = import.meta.env.VITE_AFFILIATE_ID || ''
const AFFILIATE_SIDC = import.meta.env.VITE_AFFILIATE_SIDC || ''
const AFFILIATE_CAMPAIGN = import.meta.env.VITE_AFFILIATE_CAMPAIGN || 'dst'

export default function Login() {
  const { isLoggedIn, setAuth } = useAuthStore()
  const navigate = useNavigate()
  const [loading, setLoading] = useState<'login' | 'signup' | null>(null)

  useEffect(() => {
    if (isLoggedIn) navigate('/dashboard', { replace: true })
  }, [isLoggedIn, navigate])

  async function handleLogin() {
    if (!CLIENT_ID) {
      alert('VITE_DERIV_CLIENT_ID not set in .env — use the dev bypass below for now')
      return
    }
    setLoading('login')
    const url = await buildLoginUrl(CLIENT_ID, REDIRECT_URI)
    window.location.href = url
  }

  async function handleSignup() {
    if (!CLIENT_ID) {
      alert('VITE_DERIV_CLIENT_ID not set in .env — use the dev bypass below for now')
      return
    }
    setLoading('signup')
    const url = await buildSignupUrl(CLIENT_ID, REDIRECT_URI, AFFILIATE_ID, AFFILIATE_SIDC, AFFILIATE_CAMPAIGN)
    window.location.href = url
  }

  function devLogin() {
    setAuth({ deriv_account_id: 'DEV_ACCOUNT', email: 'dev@local', currency: 'USD', country: 'KE', balance: 10000, account_type: 'demo' }, 'dev-token')
    navigate('/dashboard', { replace: true })
  }

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-8">

        {/* Brand */}
        <div className="space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-brand-blue/15 text-brand-blue font-mono font-bold text-2xl border border-brand-blue/30">
            DST
          </div>
          <h1 className="text-3xl font-bold text-ink">Digit Strategy Terminal</h1>
          <p className="text-ink-muted text-sm">
            AI-powered trading signals for Deriv synthetic indices.<br/>
            Analyze, signal, execute — all without leaving this app.
          </p>
        </div>

        {/* Features */}
        <div className="grid grid-cols-2 gap-3 text-left">
          {[
            { icon: '◎', label: 'Live tick stream from Deriv' },
            { icon: '⟨⟩', label: 'AI Markov chain signals' },
            { icon: '↑↓', label: 'Rise / Fall & Even / Odd' },
            { icon: '⚡', label: 'One-click trade execution' },
          ].map(({ icon, label }) => (
            <div key={label} className="flex items-start gap-2 p-3 rounded-lg bg-surface-3 border border-border">
              <span className="text-brand-blue mt-0.5">{icon}</span>
              <span className="text-xs text-ink">{label}</span>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="space-y-3">
          <button
            onClick={handleLogin}
            disabled={loading !== null}
            className="block w-full py-3 rounded-lg bg-brand-blue text-surface font-semibold text-sm hover:bg-brand-blue/90 transition-colors disabled:opacity-60"
          >
            {loading === 'login' ? 'Redirecting…' : 'Sign in with Deriv'}
          </button>

          {IS_DEV && (
            <button
              onClick={devLogin}
              className="block w-full py-2 rounded-lg border border-border-2 text-ink-muted text-xs hover:text-ink hover:border-ink-muted transition-colors"
            >
              ⚡ Dev bypass (local only)
            </button>
          )}

          <p className="text-xs text-ink-muted">
            Don't have an account?{' '}
            <button
              onClick={handleSignup}
              disabled={loading !== null}
              className="text-brand-blue hover:underline disabled:opacity-60"
            >
              {loading === 'signup' ? 'Redirecting…' : 'Sign up free →'}
            </button>
          </p>
        </div>

      </div>
    </div>
  )
}
