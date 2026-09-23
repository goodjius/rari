import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { createComponent } from 'solid-js'
import { hydrate } from 'solid-js/web'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import Counter from '../fixtures/solid-app/src/components/Counter'

// Closes the phase-2 verification gap ("does the island actually hydrate with
// zero mismatch?"). Two builds of solid-js are involved and one process can't
// resolve both, so: the SSR HTML is rendered in a Node child process against
// solid-js's *server* build (ssr-html.mjs, same babel `generate: 'ssr'`
// output as the real build), and it is hydrated here under jsdom with the
// *browser* build, with the Counter compiled by our own plugin (`generate:
// 'dom', hydratable: true`) via test/solid/vite.config.ts.

interface SsrResult {
  readonly html: string
  readonly renderId: string
}

function renderServerHtml(renderId: string): SsrResult {
  const out = execFileSync(process.execPath, ['test/solid/ssr-html.mjs', renderId], {
    cwd: path.resolve(import.meta.dirname, '../..'),
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion - shape is produced by ssr-html.mjs
  return JSON.parse(out) as SsrResult
}

function mount(html: string): HTMLElement {
  document.body.innerHTML = `<div id="root">${html}</div>`
  const root = document.getElementById('root')
  if (root == null) throw new Error('root missing')
  return root
}

beforeEach(() => {
  // Normally installed by generateHydrationScript() in the server document.
  Reflect.set(globalThis, '_$HY', { events: [], completed: new WeakSet(), r: {}, fe() {} })
})

describe('compiled Solid island hydration (jsdom)', () => {
  it('hydrates server HTML in place with matching renderId and stays interactive', async () => {
    const { html, renderId } = renderServerHtml('i0')
    const root = mount(html)
    const serverButton = root.querySelector('button')

    expect(serverButton?.textContent).toBe('clicks: 0')

    hydrate(() => createComponent(Counter, { label: 'clicks' }), root, { renderId })

    // Hydration reuses the server-rendered node instead of recreating it.
    expect(root.querySelector('button')).toBe(serverButton)

    serverButton?.click()
    await Promise.resolve()
    expect(root.querySelector('button')?.textContent).toBe('clicks: 1')
  })

  it('does not adopt the server node when the renderId does not match', () => {
    // Solid 1.9 doesn't throw here (contrary to what reading its hydrate()
    // source suggests): a missing hydration key just falls back to creating
    // fresh DOM. So a wrong renderId silently discards the server-rendered
    // subtree - exactly what the island row's `renderId` exists to prevent.
    const { html } = renderServerHtml('i0')
    const root = mount(html)
    const serverButton = root.querySelector('button')

    hydrate(() => createComponent(Counter, { label: 'clicks' }), root, {
      renderId: 'somethingelse',
    })

    expect(root.querySelector('button')).not.toBe(serverButton)
  })
})
