import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import axios from 'axios'

export default function AuthCallback() {
  const navigate = useNavigate()
  const { setAuth } = useAuthStore()
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true

    const params = new URLSearchParams(window.location.search)
    const token1 = params.get('token1')
    const acct1 = params.get('acct1')

    if (!token1 || !acct1) {
      navigate('/login', { replace: true })
      return
    }

    axios.post('/api/auth/callback', { token: token1, account: acct1 })
      .then(({ data }) => {
        setAuth(data.user, data.access_token)
        navigate('/dashboard', { replace: true })
      })
      .catch(() => navigate('/login', { replace: true }))
  }, [navigate, setAuth])

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center">
      <div className="text-ink-muted text-sm">Authenticating with Deriv…</div>
    </div>
  )
}
