/* oxlint-disable typescript/prefer-readonly-parameter-types -- DOM event/node types are mutable */
import type { NavigationOptions } from './types'
import { disposeSolidIslands, settleSolidIslands } from '@/runtime/islands-lifecycle'
import { isRecord } from '@/shared/utils/type-guards'
import { registerNavigate } from './navigate'

function readScrollY(state: unknown): number {
  return isRecord(state) && typeof state.rariScrollY === 'number' ? state.rariScrollY : 0
}

const NAVIGATION_TIMEOUT_MS = 30_000
const HYDRATION_BOOTSTRAP_MARKER = '_$HY'

let started = false
let activeController: AbortController | null = null

function isModifiedClick(event: MouseEvent): boolean {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
}

/** The same-origin document link a click should navigate to, or null to let the browser handle it. */
function linkTarget(event: MouseEvent): URL | null {
  if (event.defaultPrevented || isModifiedClick(event)) return null
  if (!(event.target instanceof Element)) return null

  const anchor = event.target.closest('a')
  if (anchor == null || !anchor.hasAttribute('href')) return null
  if (
    (anchor.target !== '' && anchor.target !== '_self') ||
    anchor.hasAttribute('download') ||
    anchor.hasAttribute('data-rari-reload') ||
    anchor.getAttribute('rel')?.includes('external') === true
  )
    return null

  const url = new URL(anchor.href, window.location.href)
  if (url.origin !== window.location.origin) return null
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  // Same document, only the fragment differs: native scrolling is right.
  if (
    url.pathname === window.location.pathname &&
    url.search === window.location.search &&
    url.hash !== ''
  )
    return null

  return url
}

/** Scripts from a DOMParser document never run; clones of them must be rebuilt to execute. */
function activateScripts(root: ParentNode): void {
  for (const dead of root.querySelectorAll('script')) {
    const live = document.createElement('script')
    for (const { name, value } of dead.attributes) live.setAttribute(name, value)
    live.textContent = dead.textContent
    dead.replaceWith(live)
  }
}

function swapHead(next: Document): void {
  document.title = next.title

  for (const node of document.head.querySelectorAll('[data-rari-meta]')) node.remove()
  for (const node of next.head.querySelectorAll('[data-rari-meta]'))
    document.head.append(document.importNode(node, true))

  // Keep existing stylesheets (no flash of unstyled content) and add the ones the new page needs.
  const known = new Set(
    [...document.head.querySelectorAll('link[rel="stylesheet"]')].map(link =>
      link.getAttribute('href'),
    ),
  )
  for (const link of next.head.querySelectorAll('link[rel="stylesheet"]')) {
    if (!known.has(link.getAttribute('href'))) document.head.append(document.importNode(link, true))
  }
}

function resetHydrationState(next: Document): void {
  Reflect.deleteProperty(window, HYDRATION_BOOTSTRAP_MARKER)
  for (const script of next.head.querySelectorAll('script:not([src]):not([type])')) {
    if (script.textContent.includes(HYDRATION_BOOTSTRAP_MARKER)) {
      const live = document.createElement('script')
      live.textContent = script.textContent
      document.head.append(live)
      live.remove()
    }
  }
}

function commit(next: Document): void {
  disposeSolidIslands()
  window.__rari_client_ready = false

  swapHead(next)
  for (const { name, value } of next.documentElement.attributes)
    document.documentElement.setAttribute(name, value)
  resetHydrationState(next)

  const body = document.importNode(next.body, true)
  activateScripts(body)
  document.body.className = body.className
  document.body.replaceChildren(...body.childNodes)
}

function isHtml(response: Response): boolean {
  return response.headers.get('content-type')?.includes('text/html') === true
}

async function fetchDocument(
  url: URL,
  signal: AbortSignal,
): Promise<{ readonly finalUrl: URL; readonly document: Document }> {
  const response = await fetch(url, { headers: { Accept: 'text/html' }, signal })
  if (!isHtml(response)) throw new Error(`Unexpected content type for ${url.pathname}`)

  const html = await response.text()
  return {
    finalUrl: new URL(response.url),
    document: new DOMParser().parseFromString(html, 'text/html'),
  }
}

function scrollAfterNavigation(url: URL, restoreY: number | undefined, scroll: boolean): void {
  if (restoreY !== undefined) {
    window.scrollTo(0, restoreY)
    return
  }
  if (!scroll) return

  const target =
    url.hash === '' ? null : document.getElementById(decodeURIComponent(url.hash.slice(1)))
  if (target) target.scrollIntoView()
  else window.scrollTo(0, 0)
}

async function navigateTo(
  href: string,
  options: NavigationOptions & { readonly fromHistory?: boolean; readonly restoreY?: number },
): Promise<void> {
  const url = new URL(href, window.location.href)
  activeController?.abort()
  const controller = new AbortController()
  activeController = controller
  const timeout = setTimeout(() => {
    controller.abort()
  }, NAVIGATION_TIMEOUT_MS)

  try {
    const { finalUrl, document: next } = await fetchDocument(url, controller.signal)
    if (controller.signal.aborted) return

    if (options.fromHistory !== true) {
      window.history.replaceState({ rariScrollY: window.scrollY }, '')
      const method = options.replace === true ? 'replaceState' : 'pushState'
      window.history[method]({ rariScrollY: 0 }, '', finalUrl)
    }

    commit(next)
    scrollAfterNavigation(finalUrl, options.restoreY, options.scroll !== false)
    window.dispatchEvent(
      new CustomEvent('rari:navigate', { detail: { to: finalUrl.pathname + finalUrl.search } }),
    )

    await settleSolidIslands()
    window.__rari_client_ready = true
  } catch (error) {
    if (controller.signal.aborted && activeController !== controller) return
    console.error('[rari] client navigation failed, falling back to a full page load:', error)
    window.location.assign(url)
  } finally {
    clearTimeout(timeout)
    if (activeController === controller) activeController = null
  }
}

export function startClientRouter(): void {
  if (started || typeof window === 'undefined') return
  started = true

  registerNavigate(async (href, options) => navigateTo(href, options ?? {}))

  document.addEventListener('click', event => {
    const url = linkTarget(event)
    if (url == null) return

    event.preventDefault()
    void navigateTo(url.href, {})
  })

  window.addEventListener('popstate', event => {
    void navigateTo(window.location.href, {
      fromHistory: true,
      restoreY: readScrollY(event.state),
    })
  })

  if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'
}
