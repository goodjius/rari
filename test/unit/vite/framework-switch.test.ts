import type { UserConfig } from 'vite-plus'
import { rari } from '@rari/vite'
import { scanImportStatements } from '@rari/vite/analysis/directives'
import { buildSolidIslandReplacementFromImport } from '@rari/vite/transform/solid-island-import'
import { describe, expect, it } from 'vite-plus/test'
import { castMock } from '../../helpers/mock-cast'

function names(framework?: 'react' | 'solid'): string[] {
  return rari(framework == null ? {} : { framework }).map(plugin => plugin.name)
}

function mainConfig(framework?: 'react' | 'solid'): UserConfig {
  const main = rari(framework == null ? {} : { framework }).find(plugin => plugin.name === 'rari')
  const config: UserConfig = {}
  const hook = castMock<(c: UserConfig, env: Readonly<{ command: string }>) => void>(
    castMock<{ config?: unknown }>(main).config,
  )
  hook.call({}, config, { command: 'build' })
  return config
}

type ResolveConditions = Readonly<Record<string, { resolve?: { conditions?: string[] } }>>

function conditionsFor(config: UserConfig, env: string): string[] | undefined {
  return castMock<ResolveConditions>(config.environments)[env]?.resolve?.conditions
}

describe('rari({ framework })', () => {
  it('defaults to react and registers the React refresh plugins, not the Solid compiler', () => {
    const react = names()
    expect(react).toContain('rari:react-refresh-runtime')
    expect(react).not.toContain('rari:solid-compiler')
    expect(names('react')).toEqual(react)
  })

  it('solid swaps React refresh for the Solid compiler', () => {
    const solid = names('solid')
    expect(solid).toContain('rari:solid-compiler')
    expect(solid).not.toContain('rari:react-refresh-runtime')
    expect(solid).not.toContain('rari:react-refresh-wrapper')
  })

  it('solid resolves with the solid condition instead of react-server and does not dedupe react', () => {
    const solid = mainConfig('solid')
    expect(conditionsFor(solid, 'rsc')).toEqual(['solid', 'node', 'import'])
    expect(conditionsFor(solid, 'client')).toEqual(['solid', 'browser', 'import'])
    expect(solid.resolve?.dedupe ?? []).not.toContain('react')
    expect(solid.optimizeDeps?.include ?? []).not.toContain('react')

    const react = mainConfig('react')
    expect(conditionsFor(react, 'rsc')).toEqual(['react-server', 'node', 'import'])
    expect(react.resolve?.dedupe).toContain('react')
  })
})

describe('solid island import replacement', () => {
  it('keeps the import and wraps the binding through renderSolidIsland', () => {
    const [imp] = scanImportStatements(`import Counter from './Counter'`)
    const { code } = buildSolidIslandReplacementFromImport(imp, 'src/components/Counter.tsx')
    expect(code).toContain(`import __rariIsland_Counter from "./Counter";`)
    expect(code).toContain('globalThis.renderSolidIsland(__rariIsland_Counter, props')
    expect(code).toContain('moduleId: "src/components/Counter.tsx"')
    expect(code).toContain('exportName: "default"')
  })

  it('wraps named imports with their imported export name', () => {
    const [imp] = scanImportStatements(`import { Counter as C } from './Counter'`)
    const { code } = buildSolidIslandReplacementFromImport(imp, 'src/Counter.tsx')
    expect(code).toContain('import { Counter as __rariIsland_C } from "./Counter";')
    expect(code).toContain('exportName: "Counter"')
    expect(code).toContain('const C = ')
  })

  it('leaves namespace imports alone', () => {
    const [imp] = scanImportStatements(`import * as Ns from './Counter'`)
    expect(buildSolidIslandReplacementFromImport(imp, 'x').code).toBe('')
  })
})
