import type { Plugin } from 'vite-plus'
import {
  createSolidCompilerPlugin,
  matchesSolidId,
  solidGenerateModeForConsumer,
} from '@rari/vite/transform/solid-compiler'
import { describe, expect, it } from 'vite-plus/test'
import { castMock } from '../../helpers/mock-cast'

const SOURCE = `
import { createSignal, Suspense } from 'solid-js'

function Counter(props: { label: string }) {
  const [n, setN] = createSignal(0)
  return <button class="btn" onClick={() => setN(n() + 1)}>{props.label}: {n()}</button>
}

export default function App() {
  return (
    <div id="app">
      <Suspense fallback={<p>loading</p>}>
        <Counter label="x" />
      </Suspense>
    </div>
  )
}
`

type TransformHook = (
  this: Readonly<{
    readonly environment: { readonly config: { readonly consumer: string } }
    readonly error: (message: string) => never
  }>,
  code: string,
  id: string,
) => Promise<{ code?: string } | null>

function getTransform(plugin: Plugin): TransformHook {
  const hook = plugin.transform
  if (typeof hook === 'function') {
    return async function (this, code, id) {
      return castMock(await hook.call(castMock(this), code, id))
    }
  }
  throw new Error('expected transform hook on solid-compiler plugin')
}

function context(consumer: 'client' | 'server') {
  return {
    environment: { config: { consumer } },
    error: (message: string): never => {
      throw new Error(message)
    },
  }
}

async function compile(consumer: 'client' | 'server', id = '/src/App.tsx', hmr = false) {
  const plugin = createSolidCompilerPlugin({ hmr })
  const configResolved = castMock<(c: unknown) => void>(plugin.configResolved)
  configResolved({
    isProduction: false,
    command: hmr ? 'serve' : 'build',
    build: { sourcemap: false },
  })
  return getTransform(plugin).call(context(consumer), SOURCE, id)
}

describe('solid compiler plugin', () => {
  it('maps consumer to generate mode', () => {
    expect(solidGenerateModeForConsumer('server')).toBe('ssr')
    expect(solidGenerateModeForConsumer('client')).toBe('dom')
  })

  it('only matches non-virtual, non-node_modules jsx/tsx sources', () => {
    expect(matchesSolidId('/src/App.tsx')).toBe(true)
    expect(matchesSolidId('/src/App.jsx?v=1')).toBe(true)
    expect(matchesSolidId('/src/util.ts')).toBe(false)
    expect(matchesSolidId('/node_modules/x/App.tsx')).toBe(false)
    expect(matchesSolidId('\0virtual:thing.tsx')).toBe(false)
    expect(matchesSolidId('/src/App.d.ts')).toBe(false)
  })

  it('emits ssr output (no DOM helpers) for server consumers', async () => {
    const result = await compile('server')
    const code = result?.code ?? ''
    expect(code).toContain('_$ssr(')
    expect(code).toContain('ssrHydrationKey')
    expect(code).not.toContain('_$template(')
    expect(code).not.toContain('_$insert(')
    expect(code).not.toContain('onClick')
  })

  it('emits hydratable dom output for client consumers', async () => {
    const result = await compile('client')
    const code = result?.code ?? ''
    expect(code).toContain('_$template(')
    expect(code).toContain('getNextElement')
    expect(code).toContain('_$insert(')
    expect(code).toContain('delegateEvents')
    expect(code).not.toContain('_$ssr(')
  })

  it('skips non-jsx files', async () => {
    expect(await compile('server', '/src/util.ts')).toBeNull()
  })

  it('wraps for solid-refresh only on the serve+client path', async () => {
    const client = (await compile('client', '/src/App.tsx', true))?.code ?? ''
    const server = (await compile('server', '/src/App.tsx', true))?.code ?? ''
    expect(client).toMatch(/solid-refresh|\$\$registry|\$\$component/)
    expect(server).not.toMatch(/solid-refresh/)
  })
})
