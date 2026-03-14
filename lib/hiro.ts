/** Centralized Hiro API config — URL + authenticated headers */

export const HIRO_API = 'https://api.testnet.hiro.so'

const API_KEY = process.env.HIRO_API_KEY

/**
 * When the monthly quota is exhausted, the API key causes 429 on every request.
 * Falling back to unauthenticated requests uses the per-IP rate limit instead,
 * which still works (lower limits, but not blocked).
 */
let apiKeyDisabled = false
let apiKeyDisabledAt = 0
const API_KEY_COOLDOWN_MS = 60_000 * 60 // re-check every hour

export function hiroHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...extra,
  }

  // Re-enable key periodically to check if quota has reset
  if (apiKeyDisabled && Date.now() - apiKeyDisabledAt > API_KEY_COOLDOWN_MS) {
    apiKeyDisabled = false
    console.log('[hiro] Re-enabling API key (cooldown expired)')
  }

  if (API_KEY && !apiKeyDisabled) {
    headers['x-api-key'] = API_KEY
  }
  return headers
}

/**
 * Call this when a 429 with "Monthly rate limit exceeded" is detected.
 * Disables the API key so subsequent requests use per-IP rate limits.
 */
export function disableApiKey(): void {
  if (!apiKeyDisabled) {
    apiKeyDisabled = true
    apiKeyDisabledAt = Date.now()
    console.warn('[hiro] API key disabled — monthly quota exhausted, falling back to per-IP rate limits')
  }
}

/** Convenience fetch wrapper that injects the API key + auto-fallback on monthly 429 */
export async function hiroFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = path.startsWith('http') ? path : `${HIRO_API}${path}`
  const res = await fetch(url, {
    ...init,
    headers: {
      ...hiroHeaders(),
      ...(init?.headers as Record<string, string>),
    },
  })

  // Auto-detect monthly quota exhaustion and disable key
  if (res.status === 429 && API_KEY && !apiKeyDisabled) {
    const remaining = res.headers.get('x-ratelimit-remaining-stacks-month')
    if (remaining === '0' || remaining === '-1') {
      disableApiKey()
      // Retry without the key
      return fetch(url, {
        ...init,
        headers: {
          ...hiroHeaders(),
          ...(init?.headers as Record<string, string>),
        },
      })
    }
  }

  return res
}
