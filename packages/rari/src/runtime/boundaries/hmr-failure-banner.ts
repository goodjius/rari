export type HmrFailureType = 'fetch' | 'parse' | 'stale' | 'network'

export interface HmrFailure {
  readonly timestamp: number
  readonly error: Error
  readonly type: HmrFailureType
  readonly details: string
  readonly filePath?: string
  readonly consecutiveFailures: number
}

export interface HmrFailureBannerOptions {
  readonly failure: HmrFailure
  readonly maxRetries: number
  readonly onRefresh: () => void
  readonly onDismiss: () => void
}

export const HMR_FAILURE_BANNER_ID = 'rari-hmr-failure-banner'

const OVERLAY_CSS =
  'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);padding:24px;background:rgba(220,38,38,0.95);color:white;border-radius:8px;font-size:14px;z-index:10000;max-width:500px;box-shadow:0 4px 6px rgba(0,0,0,0.3);'
const PRIMARY_BUTTON_CSS =
  'padding:8px 16px;background:white;color:#dc2626;border:none;border-radius:4px;cursor:pointer;font-weight:bold;font-size:14px;'
const SECONDARY_BUTTON_CSS =
  'padding:8px 16px;background:rgba(255,255,255,0.2);color:white;border:1px solid rgba(255,255,255,0.3);border-radius:4px;cursor:pointer;font-size:14px;'

const FAILURE_MESSAGES: Record<HmrFailureType, string> = {
  fetch: 'Failed to fetch updated content from server.',
  parse: 'Failed to parse server response.',
  stale: 'Server returned stale content.',
  network: 'Network error occurred.',
}

function line(text: string, css: string): HTMLElement {
  const el = document.createElement('div')
  el.style.cssText = css
  el.textContent = text
  return el
}

function button(label: string, css: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.style.cssText = css
  el.textContent = label
  el.addEventListener('click', onClick)
  return el
}

export function removeHmrFailureBanner(): void {
  document.getElementById(HMR_FAILURE_BANNER_ID)?.remove()
}

export function showHmrFailureBanner(options: Readonly<HmrFailureBannerOptions>): void {
  removeHmrFailureBanner()

  const { failure, maxRetries, onRefresh, onDismiss } = options
  const banner = document.createElement('div')
  banner.id = HMR_FAILURE_BANNER_ID
  banner.setAttribute('role', 'alert')
  banner.style.cssText = OVERLAY_CSS

  const buttons = document.createElement('div')
  buttons.style.cssText = 'display:flex;gap:8px;'
  buttons.append(
    button('Refresh Page', PRIMARY_BUTTON_CSS, onRefresh),
    button('Dismiss', SECONDARY_BUTTON_CSS, () => {
      removeHmrFailureBanner()
      onDismiss()
    }),
  )

  banner.append(
    line('HMR Update Failed', 'margin-bottom:16px;font-weight:bold;font-size:16px;'),
    line(FAILURE_MESSAGES[failure.type], 'margin-bottom:12px;opacity:0.9;'),
    line(failure.details, 'margin-bottom:16px;font-size:12px;opacity:0.8;font-family:monospace;'),
    line(
      `Consecutive failures: ${failure.consecutiveFailures} / ${maxRetries}`,
      'margin-bottom:12px;font-size:12px;opacity:0.7;',
    ),
    buttons,
    line(
      'Check the console for detailed error logs.',
      'margin-top:12px;font-size:11px;opacity:0.6;',
    ),
  )
  document.body.append(banner)
}
