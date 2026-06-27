const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'

export function generateCodeVerifier(): string {
  const arr = crypto.getRandomValues(new Uint8Array(64))
  return Array.from(arr).map(v => CHARSET[v % CHARSET.length]).join('')
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function generateState(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function buildLoginUrl(clientId: string, redirectUri: string): Promise<string> {
  const verifier = generateCodeVerifier()
  const challenge = await generateCodeChallenge(verifier)
  const state = generateState()

  sessionStorage.setItem('pkce_verifier', verifier)
  sessionStorage.setItem('oauth_state', state)

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'trade',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })
  return `https://auth.deriv.com/oauth2/auth?${params}`
}

export async function buildSignupUrl(
  clientId: string,
  redirectUri: string,
  affiliateId: string,
  sidc: string,
  campaign: string,
): Promise<string> {
  const verifier = generateCodeVerifier()
  const challenge = await generateCodeChallenge(verifier)
  const state = generateState()

  sessionStorage.setItem('pkce_verifier', verifier)
  sessionStorage.setItem('oauth_state', state)

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'trade',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'registration',
    ...(sidc && { sidc }),
    ...(affiliateId && { utm_source: affiliateId, utm_medium: 'affiliate' }),
    ...(campaign && { utm_campaign: campaign }),
  })
  return `https://auth.deriv.com/oauth2/auth?${params}`
}
