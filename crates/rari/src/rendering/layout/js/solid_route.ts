/* oxlint-disable typescript/no-unsafe-type-assertion, typescript/prefer-readonly-parameter-types, typescript/non-nullable-type-assertion-style -- Rust-embedded script: bare `import()` of vendored Solid modules and `g` globals are untyped at this boundary */
/// <reference path="../../types.d.ts" />

/**
 * Route-level Solid rendering for the real server path (the Solid counterpart
 * to layout/core.rs's React composition scripts + streaming_fizz.ts). Rust
 * passes only JSON (component ids, props, head HTML); composition happens
 * here because Solid's `children` getters and closures are painful to
 * string-splice from a Rust `format!`.
 *
 * Components are looked up on `globalThis[componentId]`, exactly where the
 * existing (framework-agnostic) component loader binds each module's default
 * export.
 */

interface SolidRouteOptions {
  readonly pageId: string
  /** Root-first, like `AppRouteMatch.layouts`. */
  readonly layoutIds: readonly string[]
  /** Root-first. */
  readonly templateIds: readonly string[]
  readonly loadingId: string | null
  readonly errorId: string | null
  readonly props: Record<string, unknown>
  readonly pathname: string
  readonly headContent: string
  readonly metadata: Record<string, unknown> | null
  readonly streamId: string
}

type SolidComponentFn = (props: Record<string, unknown>) => unknown

function rariSolidEscapeAttr(value: string): string {
  return value
    .split('&')
    .join('&amp;')
    .split('"')
    .join('&quot;')
    .split('<')
    .join('&lt;')
    .split('>')
    .join('&gt;')
}

function rariSolidEscapeText(value: string): string {
  return value.split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;')
}

function rariSolidTag(name: string, attrs: Record<string, string>): string {
  let out = `<${name}`
  for (const key of Object.keys(attrs)) out += ` ${key}="${rariSolidEscapeAttr(attrs[key])}"`
  return `${out} data-rari-meta="1">`
}

function rariSolidNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

/**
 * `PageMetadata` (JSON from `metadata_collector.ts` / Rust) -> head tags as an HTML
 * string. Mirrors the field mapping of react/metadata_head.ts's
 * `buildMetadataHeadElements`, minus its React-element cloning.
 */
function rariSolidMetadataToHtml(metadata: Record<string, unknown> | null): string {
  const m = metadata ?? {}
  const parts: string[] = []
  const meta = (attrs: Record<string, string>) => parts.push(rariSolidTag('meta', attrs))
  const link = (attrs: Record<string, string>) => parts.push(rariSolidTag('link', attrs))

  parts.push('<meta charset="UTF-8" data-rari-meta="1">')
  meta({
    name: 'viewport',
    content: rariSolidNonEmpty(m.viewport) ? m.viewport : 'width=device-width, initial-scale=1.0',
  })
  if (rariSolidNonEmpty(m.title))
    parts.push(`<title data-rari-meta="1">${rariSolidEscapeText(m.title)}</title>`)
  if (rariSolidNonEmpty(m.description)) meta({ name: 'description', content: m.description })
  if (Array.isArray(m.keywords) && m.keywords.length > 0)
    meta({ name: 'keywords', content: m.keywords.join(', ') })

  const robots = m.robots as Record<string, unknown> | undefined
  if (robots != null && typeof robots === 'object') {
    const flags: string[] = []
    if (robots.index === false) flags.push('noindex')
    if (robots.index === true) flags.push('index')
    if (robots.follow === false) flags.push('nofollow')
    if (robots.follow === true) flags.push('follow')
    if (flags.length > 0) meta({ name: 'robots', content: flags.join(', ') })
  }

  if (rariSolidNonEmpty(m.canonical)) link({ rel: 'canonical', href: m.canonical })
  if (rariSolidNonEmpty(m.manifest)) link({ rel: 'manifest', href: m.manifest })

  const og = m.openGraph as Record<string, unknown> | undefined
  if (og != null && typeof og === 'object') {
    if (rariSolidNonEmpty(og.title)) meta({ property: 'og:title', content: og.title })
    if (rariSolidNonEmpty(og.description))
      meta({ property: 'og:description', content: og.description })
    if (rariSolidNonEmpty(og.url)) meta({ property: 'og:url', content: og.url })
    if (rariSolidNonEmpty(og.siteName)) meta({ property: 'og:site_name', content: og.siteName })
    if (rariSolidNonEmpty(og.type)) meta({ property: 'og:type', content: og.type })
    if (Array.isArray(og.images)) {
      for (const image of og.images) {
        const url = typeof image === 'string' ? image : (image as Record<string, unknown>).url
        if (rariSolidNonEmpty(url)) meta({ property: 'og:image', content: url })
      }
    }
  }

  const tw = m.twitter as Record<string, unknown> | undefined
  if (tw != null && typeof tw === 'object') {
    for (const key of ['card', 'site', 'creator', 'title', 'description']) {
      const value = tw[key]
      if (rariSolidNonEmpty(value)) meta({ name: `twitter:${key}`, content: value })
    }
    if (Array.isArray(tw.images)) {
      for (const image of tw.images) {
        if (rariSolidNonEmpty(image)) meta({ name: 'twitter:image', content: image })
      }
    }
  }

  if (rariSolidNonEmpty(m.themeColor)) meta({ name: 'theme-color', content: m.themeColor })

  return parts.join('')
}

/**
 * Buffers the stream until the first `</head>`, injects `headHtml` there (the
 * client head - CSS links, dev/prod client entry - plus hydration bootstrap
 * and metadata), and strips a leading doctype (the Rust side already writes
 * the `<!DOCTYPE html>` shell). Same idea as streaming_fizz.ts's
 * `rariInjectHeadContent`/`rariStripLeadingDoctype`, over Solid's output.
 */
function rariSolidHeadInjector(headHtml: string): SolidStreamTransform {
  let buffer = ''
  let injected = false
  let first = true
  return {
    write(text: string): string {
      let chunk = text
      if (first) {
        first = false
        chunk = chunk.replace(/^\s*<!doctype html>/i, '')
      }
      if (injected) return chunk
      buffer += chunk
      const idx = buffer.toLowerCase().indexOf('</head>')
      if (idx === -1) return ''
      injected = true
      const out = buffer.slice(0, idx) + headHtml + buffer.slice(idx)
      buffer = ''
      return out
    },
    end(): string {
      const rest = buffer
      buffer = ''
      return rest
    },
  }
}

function rariSolidLookup(id: string): SolidComponentFn {
  const component = (g as Record<string, unknown>)[id]
  if (typeof component !== 'function') throw new Error(`[rari] Solid component ${id} not found`)
  return component as SolidComponentFn
}

async function renderSolidRouteStreaming(options: SolidRouteOptions): Promise<void> {
  const solidWeb = (await import('solid-js/web')) as unknown as {
    renderToStream: (fn: () => unknown) => { pipe: (w: SolidStreamWritable) => void }
    generateHydrationScript: () => string
  }
  const solid = (await import('solid-js')) as unknown as {
    createComponent: (c: SolidComponentFn, props: Record<string, unknown>) => unknown
    Suspense: SolidComponentFn
    ErrorBoundary: SolidComponentFn
  }
  const { createComponent, Suspense, ErrorBoundary } = solid

  ;(g.resetSolidIslandState as () => void)()

  const Page = rariSolidLookup(options.pageId)
  let node: () => unknown = () => createComponent(Page, options.props)

  if (options.loadingId != null) {
    const Loading = rariSolidLookup(options.loadingId)
    const inner = node
    node = () =>
      createComponent(Suspense, {
        get fallback() {
          return createComponent(Loading, {})
        },
        get children() {
          return inner()
        },
      })
  }

  for (let i = options.templateIds.length - 1; i >= 0; i -= 1) {
    const Template = rariSolidLookup(options.templateIds[i])
    const inner = node
    node = () =>
      createComponent(Template, {
        get children() {
          return inner()
        },
      })
  }

  if (options.errorId != null) {
    const ErrorComponent = rariSolidLookup(options.errorId)
    const inner = node
    node = () =>
      createComponent(ErrorBoundary, {
        fallback: (error: unknown, reset: () => void) =>
          createComponent(ErrorComponent, { error, reset }),
        get children() {
          return inner()
        },
      })
  }

  for (let i = options.layoutIds.length - 1; i >= 0; i -= 1) {
    const Layout = rariSolidLookup(options.layoutIds[i])
    const inner = node
    node = () =>
      createComponent(Layout, {
        pathname: options.pathname,
        get children() {
          return inner()
        },
      })
  }

  const headHtml =
    solidWeb.generateHydrationScript() +
    rariSolidMetadataToHtml(options.metadata) +
    options.headContent

  await rariSolidPipeToOps(
    options.streamId,
    writable => {
      solidWeb.renderToStream(node).pipe(writable)
    },
    rariSolidHeadInjector(headHtml),
  )
}

g.renderSolidRouteStreaming = renderSolidRouteStreaming
