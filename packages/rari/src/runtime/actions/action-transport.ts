import { isError } from '@/shared/utils/type-guards'

const ACTION_REQUEST_TIMEOUT_MS = 30_000

const ALLOWED_REDIRECT_PROTOCOLS = new Set(['http:', 'https:'])

function actionPostUrl(): string {
  if (typeof window !== 'undefined') return window.location.pathname + window.location.search

  return '/'
}

export function applyRedirect(redirect: string) {
  if (typeof window === 'undefined') return

  try {
    const absoluteRedirect = new URL(redirect, window.location.href)
    if (!ALLOWED_REDIRECT_PROTOCOLS.has(absoluteRedirect.protocol)) return

    if (absoluteRedirect.href !== window.location.href) window.location.href = absoluteRedirect.href
  } catch {
    // Ignore malformed redirect targets.
  }
}

export async function postAction(
  id: string,
  headers: Readonly<Record<string, string>>,
  body: BodyInit,
): Promise<Response> {
  try {
    return await fetch(actionPostUrl(), {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(ACTION_REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    if (
      (error instanceof DOMException && error.name === 'TimeoutError') ||
      (isError(error) && error.name === 'AbortError')
    ) {
      throw new Error(`Server action "${id}" timed out after ${ACTION_REQUEST_TIMEOUT_MS}ms`)
    }

    throw error
  }
}

/** Location from `x-action-redirect` (`<url>;push`), or null when absent. */
export function readActionRedirect(response: Response): string | null {
  const redirectHeader = response.headers.get('x-action-redirect')
  if (redirectHeader == null || redirectHeader === '') return null
  const [location = ''] = redirectHeader.split(';')
  return location
}
