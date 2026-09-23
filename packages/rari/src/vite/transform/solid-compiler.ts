import type * as babel from '@babel/core'
import type { Plugin } from 'vite-plus'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { stripQuery } from '../../shared/utils/path'
import { asError } from '../../shared/utils/type-guards'

/**
 * Solid JSX compiler plugin (Babel + babel-preset-solid). There is no
 * Babel-free path: `oxc-transform` can only emit React-style JSX runtimes or
 * preserve JSX, it cannot produce dom-expressions output (`_$template`,
 * `_$ssr`). Babel is loaded lazily so React apps never pay for (or need) it.
 *
 * The same source is compiled twice, keyed off the Vite environment's
 * `consumer` exactly like react-compiler.ts does: server environments
 * (`rsc`, `ssr`) get `generate: 'ssr'`, the browser gets `generate: 'dom'`,
 * both hydratable so server and client agree on `data-hk` ids.
 */

export type SolidGenerateMode = 'dom' | 'ssr'

export interface SolidCompilerOptions {
  /** Enable solid-refresh HMR wrapping (dev server, client environment only). */
  readonly hmr?: boolean
}

const SOLID_JSX_RE = /\.[cm]?[jt]sx$/
const TS_RE = /\.[cm]?tsx?$/

export const SOLID_REFRESH_PATH = '/@solid-refresh'

const SOLID_DEDUPE = ['solid-js', 'solid-js/web', 'solid-js/store', 'solid-js/html', 'solid-js/h']

export function matchesSolidId(id: string): boolean {
  if (id.startsWith('\0') || id.includes('virtual:')) return false
  const cleanId = stripQuery(id)
  if (/\.d\.[cm]?ts$/.test(cleanId)) return false
  if (cleanId.includes('/dist/')) return false
  return SOLID_JSX_RE.test(cleanId) && !cleanId.includes('/node_modules/')
}

export function solidGenerateModeForConsumer(consumer: 'client' | 'server'): SolidGenerateMode {
  return consumer === 'server' ? 'ssr' : 'dom'
}

interface BabelModules {
  babel: typeof babel
  preset: babel.PluginItem
  refresh: babel.PluginItem | undefined
}

export function createSolidCompilerPlugin(options: SolidCompilerOptions = {}): Plugin {
  const hmrEnabled = options.hmr !== false
  let modules: BabelModules | undefined
  let sourcemap = true
  let isServe = false
  let isProduction = false

  const load = async (onError: (message: string) => never): Promise<BabelModules> => {
    if (modules) return modules
    try {
      const [babel, presetMod] = await Promise.all([
        import('@babel/core'),
        import('babel-preset-solid'),
      ])
      let refresh: babel.PluginItem | undefined
      if (hmrEnabled) {
        try {
          refresh = (await import('solid-refresh/babel')).default
        } catch {
          refresh = undefined
        }
      }
      modules = { babel, preset: presetMod.default, refresh }
      return modules
    } catch (error) {
      const cause = asError(error)
      return onError(
        `The Solid compiler requires the optional \`@babel/core\` (v7) and \`babel-preset-solid\` packages. Install them before using \`rari({ framework: 'solid' })\`.${
          cause != null ? `\n${cause.message}` : ''
        }`,
      )
    }
  }

  return {
    name: 'rari:solid-compiler',
    enforce: 'pre',
    config(_, { command }) {
      isServe = command === 'serve'
      return {
        // Rolldown would otherwise inject React's jsx-dev-runtime while
        // dependency-scanning .tsx; Solid JSX must be left for Babel.
        oxc: { jsx: 'preserve' },
        optimizeDeps: {
          include: SOLID_DEDUPE,
          rolldownOptions: { transform: { jsx: 'preserve' } },
        },
        resolve: {
          dedupe: SOLID_DEDUPE,
          // solid-refresh's Babel plugin emits `import ... from 'solid-refresh'`;
          // serve its runtime from a stable virtual path (as vite-plugin-solid does).
          ...(command === 'serve' && hmrEnabled
            ? { alias: [{ find: /^solid-refresh$/, replacement: SOLID_REFRESH_PATH }] }
            : {}),
        },
      }
    },
    resolveId(id) {
      return id === SOLID_REFRESH_PATH && isServe ? id : null
    },
    load(id) {
      if (id !== SOLID_REFRESH_PATH || !isServe) return null
      const req = createRequire(import.meta.url)
      return fs.readFileSync(req.resolve('solid-refresh/dist/solid-refresh.mjs'), 'utf-8')
    },
    configResolved(config) {
      isProduction = config.isProduction
      isServe = config.command === 'serve'
      sourcemap = config.command !== 'build' || config.build.sourcemap !== false
    },
    async transform(code, id) {
      if (!matchesSolidId(id)) return null
      const filename = stripQuery(id)

      const { babel, preset, refresh } = await load(message => this.error(message))
      const consumer = this.environment.config.consumer === 'server' ? 'server' : 'client'
      const generate = solidGenerateModeForConsumer(consumer)

      const plugins: babel.PluginItem[] = []
      if (generate === 'dom' && isServe && !isProduction && hmrEnabled && refresh != null)
        plugins.push([refresh, { bundler: 'vite' }])

      const result = await babel.transformAsync(code, {
        filename,
        configFile: false,
        babelrc: false,
        sourceMaps: sourcemap,
        ast: false,
        parserOpts: { plugins: TS_RE.test(filename) ? ['jsx', 'typescript'] : ['jsx'] },
        plugins,
        presets: [[preset, { generate, hydratable: true }]],
      })

      if (result?.code == null) return null
      return { code: result.code, map: result.map ?? null }
    },
  }
}
