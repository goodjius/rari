import type { Accessor, JSX } from 'solid-js'
import type { NavigationOptions } from './types'
import {
  createComponent,
  createContext,
  createSignal,
  onCleanup,
  onMount,
  useContext,
} from 'solid-js'
import { getCustomEventDetail, isRecord } from '@/shared/utils/type-guards'
import { getNavigate } from './navigate'

type NavigateFn = (href: string, options?: NavigationOptions) => Promise<void>

function isNavigateDetail(detail: unknown): detail is { to: string } {
  return isRecord(detail) && typeof detail.to === 'string'
}

function isRegisterNavigateDetail(detail: unknown): detail is { navigate: NavigateFn } {
  return isRecord(detail) && typeof detail.navigate === 'function'
}

export interface RouterContextValue {
  pathname: Accessor<string>
  searchParams: Accessor<URLSearchParams>
  push: NavigateFn
  replace: NavigateFn
  back: () => void
  forward: () => void
  refresh: () => void
  prefetch: (href: string) => Promise<void>
}

const RouterContext = createContext<RouterContextValue>()

export interface RouterProviderProps {
  readonly children: JSX.Element
  readonly initialPathname: string
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- JSX.Element is a mutable DOM node type
export function RouterProvider(props: RouterProviderProps): JSX.Element {
  const [pathname, setPathname] = createSignal(props.initialPathname)
  const [searchParams, setSearchParams] = createSignal(
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams(),
  )
  let navigateRef: NavigateFn | null = null

  onMount(() => {
    const existingNavigate = getNavigate()
    if (existingNavigate) navigateRef = existingNavigate

    const handleNavigate = (event: Event) => {
      const detail = getCustomEventDetail(event, isNavigateDetail)
      if (detail) {
        setPathname(detail.to)
        setSearchParams(new URLSearchParams(window.location.search))
      }
    }
    const handleRegisterNavigate = (event: Event) => {
      const detail = getCustomEventDetail(event, isRegisterNavigateDetail)
      if (detail) navigateRef = detail.navigate
    }
    const handleDeregisterNavigate = () => {
      navigateRef = null
    }

    window.addEventListener('rari:navigate', handleNavigate)
    window.addEventListener('rari:register-navigate', handleRegisterNavigate)
    window.addEventListener('rari:deregister-navigate', handleDeregisterNavigate)
    onCleanup(() => {
      window.removeEventListener('rari:navigate', handleNavigate)
      window.removeEventListener('rari:register-navigate', handleRegisterNavigate)
      window.removeEventListener('rari:deregister-navigate', handleDeregisterNavigate)
    })
  })

  const value: RouterContextValue = {
    pathname,
    searchParams,
    push: async (href, options) => {
      if (navigateRef) {
        await navigateRef(href, options)
      } else {
        window.location.href = href
      }
    },
    replace: async (href, options) => {
      if (navigateRef) {
        await navigateRef(href, { ...options, replace: true })
      } else {
        window.location.replace(href)
      }
    },
    back: () => {
      window.history.back()
    },
    forward: () => {
      window.history.forward()
    },
    refresh: () => {
      window.location.reload()
    },
    prefetch: async href => {
      try {
        const url = new URL(href, window.location.origin)
        await fetch(url.pathname + url.search, {
          headers: { Accept: 'text/html' },
          priority: 'low',
        })
      } catch (error) {
        console.warn('[rari] Prefetch failed:', error)
      }
    },
  }

  return createComponent(RouterContext.Provider, {
    value,
    get children() {
      return props.children
    },
  })
}

export function useRouter(): RouterContextValue {
  const context = useContext(RouterContext)
  if (!context) throw new Error('useRouter must be used within a RouterProvider')
  return context
}

export function usePathname(): Accessor<string> {
  return useRouter().pathname
}

export function useSearchParams(): Accessor<URLSearchParams> {
  return useRouter().searchParams
}
