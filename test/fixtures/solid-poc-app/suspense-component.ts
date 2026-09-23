// Streaming/Suspense fixture for the Solid migration's streaming phase.
// Wraps a createResource() that resolves after a real delay in a
// <Suspense> boundary, so a real renderToStream() run has to flush the
// fallback first and stream the real content in later - proving Solid's
// own native boundary-reveal mechanism actually runs, not just that a
// synchronous render doesn't crash.
//
// `children` MUST be a getter, not a plain property: solid-js's own
// Suspense reads `props.children` lazily (`get children() { return
// catchError(() => props.children, ...) }`, confirmed by reading
// node_modules/.pnpm/solid-js@1.9.15/node_modules/solid-js/dist/server.js)
// specifically so it can set up its own hydration/registration context
// before the children render - a plain property would evaluate eagerly,
// before Suspense has a chance to do that setup.

import { createComponent, createResource, Suspense } from 'solid-js'
import { ssrElement } from 'solid-js/web'

function delayedValue(): Promise<string> {
  return new Promise(resolve => {
    setTimeout(() => resolve('resolved-value'), 20)
  })
}

function ResourceContent(): unknown {
  const [data] = createResource(delayedValue)
  return ssrElement('span', { id: 'resource-content' }, () => data() ?? 'loading', false)
}

export default function SuspenseFixture(): unknown {
  return createComponent(Suspense, {
    fallback: ssrElement('span', { id: 'suspense-fallback' }, 'Loading...', false),
    get children() {
      return createComponent(ResourceContent, {})
    },
  })
}
