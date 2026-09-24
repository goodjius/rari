import type { UserConfig } from 'vite-plus'
import { rari } from '@rari/vite'
import { scanImportStatements } from '@rari/vite/analysis/directives'
import { buildSolidIslandReplacementFromImport } from '@rari/vite/transform/solid-island-import'
import { describe, expect, it } from 'vite-plus/test'
import { castMock } from '../../helpers/mock-cast'

function names(): string[] {
  return rari().map(plugin => plugin.name)
}

function mainConfig(): UserConfig {
  const main = rari().find(plugin => plugin.name === 'rari')
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

describe('rari() plugin set', () => {
  it('registers the Solid compiler and no React plugins', () => {
    const plugins = names()
    expect(plugins).toContain('rari:solid-compiler')
    expect(plugins.filter(name => name.includes('react'))).toEqual([])
  })

  it('resolves with the solid condition in every environment and does not touch react', () => {
    const config = mainConfig()
    expect(conditionsFor(config, 'rsc')).toEqual(['solid', 'node', 'import'])
    expect(conditionsFor(config, 'ssr')).toEqual(['solid', 'node', 'import'])
    expect(conditionsFor(config, 'client')).toEqual(['solid', 'browser', 'import'])
    expect(config.resolve?.dedupe ?? []).not.toContain('react')
    expect(config.optimizeDeps?.include ?? []).not.toContain('react')
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
