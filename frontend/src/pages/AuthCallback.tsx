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
    const code = params.get('code')
    const state = params.get('state')
    const error = params.get('error')

    if (error) {
      navigate('/login', { replace: true })
      return
    }

    const storedState = sessionStorage.getItem('oauth_state')
    const codeVerifier = sessionStorage.getItem('pkce_verifier')

    if (!code || !codeVerifier || state !== storedState) {
      navigate('/login', { replace: true })
      return
    }

    sessionStorage.removeItem('oauth_state')
    sessionStorage.removeItem('pkce_verifier')

    // Read affiliate params stored before the Deriv redirect
    const utmSource   = sessionStorage.getItem('aff_utm_source')
    const utmMedium   = sessionStorage.getItem('aff_utm_medium')
    const utmCampaign = sessionStorage.getItem('aff_utm_campaign')
    const sidc        = sessionStorage.getItem('aff_sidc')
    sessionStorage.removeItem('aff_utm_source')
    sessionStorage.removeItem('aff_utm_medium')
    sessionStorage.removeItem('aff_utm_campaign')
    sessionStorage.removeItem('aff_sidc')

    axios.post('/api/auth/callback', {
      code,
      code_verifier: codeVerifier,
      ...(utmSource   && { utm_source: utmSource }),
      ...(utmMedium   && { utm_medium: utmMedium }),
      ...(utmCampaign && { utm_campaign: utmCampaign }),
      ...(sidc        && { sidc }),
    })
      .then(({ data }) => {
        setAuth(data.user, data.access_token)
        navigate('/dashboard', { replace: true })
      })
      .catch(() => navigate('/login', { replace: true }))
  }, [navigate, setAuth])

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center gap-3">
      <div className="w-8 h-8 border-2 border-brand-blue border-t-transparent rounded-full animate-spin" />
      <div className="text-ink-muted text-sm">Authenticating with Deriv…</div>
    </div>
  )
}
