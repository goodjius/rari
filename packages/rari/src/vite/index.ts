import type { ChildProcess } from 'node:child_process'
import type { IncomingMessage } from 'node:http'
import type { CSSModulesOptions, Plugin, UserConfig } from 'vite-plus'
import type { ModuleAnalysis } from './analysis/directives'
import type { MdxPluginOptions } from './mdx/registry'
import type { RariPlugin } from './plugin/types'
import type { ServerBuildOptions } from './server/build'
import type { ServerCacheConfig, ServerCacheLayerConfig } from './server/config'
import type { ProxyPluginOptions } from '@/proxy/build/vite-plugin'
import { Buffer } from 'node:buffer'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { text as readRequestText } from 'node:stream/consumers'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_DEVICE_SIZES,
  DEFAULT_FORMATS,
  DEFAULT_IMAGE_SIZES,
  DEFAULT_MINIMUM_CACHE_TTL,
  DEFAULT_QUALITY_LEVELS,
} from '@/image/constants'
import { rariProxy } from '@/proxy/build/vite-plugin'
import { rariRouter } from '@/router/build/vite-plugin'
import { EXTENSION_REGEX, HTTP_PROTOCOL_REGEX, TSX_EXT_REGEX } from '@/shared/regex-constants'
import { clearFileResolverCache, resolveImportToFilePath } from '@/shared/utils/file-resolver'
import { isPathInside, normalizeAssetsDir, pathnameFromUrl, toPosixPath } from '@/shared/utils/path'
import { getRariServerPort } from '@/shared/utils/server-port'
import {
  errorMessage,
  getErrnoCode,
  isRecord,
  parseJsonArrayRecord,
  parseJsonRecord,
} from '@/shared/utils/type-guards'
import { readViteAliases, resolvePluginPaths } from '@/shared/utils/vite-aliases'
import { getComponentId } from './analysis/component-ids'
import {
  analyzeModuleSource,
  collectExportNames,
  hasDefaultExport,
  scanImportStatements,
} from './analysis/directives'
import {
  collectClientComponentPaths,
  invalidateModuleCachePath,
  ModuleAnalysisCache,
  resolveModuleCachePath,
} from './analysis/module-cache'
import { normalizeScanDirs } from './analysis/source-walker'
import { createSilenceDirectiveLogsPlugin } from './build/silence-directive-logs'
import {
  buildClientHeadFromBundle,
  CLIENT_HEAD_FILE,
  collectLayoutCssDevHrefs,
  resetClientHeadExtras,
  VIRTUAL_CLIENT_ENTRY,
} from './client-head'
import { createFontPlugin } from './font/plugin'
import { HMRCoordinator } from './hmr/coordinator'
import { walkImporters } from './hmr/import-graph'
import { createStaticImagePlugin } from './image/static-import'
import {
  generateMdxRegistryModule,
  isMdxRegistryModuleId,
  resolveMdxRegistryEntries,
} from './mdx/registry'
import { toRariPlugins } from './plugin/types'
import {
  createServerBuildPlugin,
  isServerComponentFromAnalysis,
  RARI_CSS_MODULES_PATTERN,
  scanDirectory,
  ServerComponentBuilder,
} from './server/build'
import { clearViteEmitBuilder, getOrCreateViteEmitBuilder } from './server/rsc-vite-build'
import { transformInlineServerActions } from './transform/inline-server-action'
import { transformDefineMdxComponents } from './transform/mdx-components'
import { createSolidCompilerPlugin } from './transform/solid-compiler'
import { buildSolidIslandReplacementFromImport } from './transform/solid-island-import'
import { getUseCacheTransform } from './transform/use-cache'

const PROXY_BODY_MAX_BYTES = 10 * 1024 * 1024
const DOCUMENT_ASSET_EXT_RE =
  /\.(?:js|mjs|cjs|ts|tsx|jsx|css|map|json|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|eot|txt|xml|html|wasm)$/i

/* oxlint-disable-next-line typescript/prefer-readonly-parameter-types IncomingMessage is a mutable Node stream */
async function readRequestBodyAsBlob(req: IncomingMessage, maxBytes: number): Promise<Blob> {
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  for await (const chunk of req) {
    const bytes = Uint8Array.from(Buffer.from(chunk))
    totalBytes += bytes.byteLength
    if (totalBytes > maxBytes) {
      req.destroy()
      throw Object.assign(new Error('Request body too large'), { statusCode: 413 })
    }
    chunks.push(bytes)
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new Blob([body])
}

function isLikelyStaticAssetPath(pathname: string): boolean {
  const basename = pathname.slice(pathname.lastIndexOf('/') + 1)
  return DOCUMENT_ASSET_EXT_RE.test(basename)
}

function isReservedRoutePrefix(pathname: string, segment: string): boolean {
  return pathname === segment || pathname.startsWith(`${segment}/`)
}

const USE_CLIENT_DIRECTIVE_REGEX = /^['"]use client['"];?\s*$/gm
const LOCAL_IMPORT_SOURCE_REGEX = /^[./@~#]/

function matchesAliasImport(source: string, aliases: Readonly<Record<string, string>>): boolean {
  for (const alias of Object.keys(aliases)) {
    if (source === alias || source.startsWith(`${alias}/`)) return true
  }
  return false
}

export interface RouterPluginOptions {
  readonly appDir?: string
  readonly extensions?: readonly string[]
}

export interface RariOptions {
  readonly projectRoot?: string
  readonly serverBuild?: ServerBuildOptions
  readonly serverHandler?: boolean
  readonly proxy?: ProxyPluginOptions | false
  readonly router?: RouterPluginOptions | false
  readonly images?: {
    readonly remotePatterns?: ReadonlyArray<{
      readonly protocol?: 'http' | 'https'
      readonly hostname: string
      readonly port?: string
      readonly pathname?: string
      readonly search?: string
    }>
    readonly localPatterns?: ReadonlyArray<{
      readonly pathname: string
      readonly search?: string
    }>
    readonly deviceSizes?: readonly number[]
    readonly imageSizes?: readonly number[]
    readonly formats?: readonly ('avif' | 'webp')[]
    readonly qualityAllowlist?: readonly number[]
    readonly minimumCacheTTL?: number
  }
  readonly csp?: {
    readonly scriptSrc?: readonly string[]
    readonly styleSrc?: readonly string[]
    readonly imgSrc?: readonly string[]
    readonly fontSrc?: readonly string[]
    readonly connectSrc?: readonly string[]
    readonly defaultSrc?: readonly string[]
    readonly workerSrc?: readonly string[]
    readonly frameAncestors?: readonly string[]
    readonly frameSrc?: readonly string[]
    readonly baseUri?: readonly string[]
    readonly formAction?: readonly string[]
    readonly useNonces?: boolean
    readonly embedderPolicy?: 'credentialless' | 'unsafe-none'
  }
  readonly cacheControl?: {
    readonly routes: Readonly<Record<string, string>>
  }
  readonly action?: {
    readonly allowedOrigins?: readonly string[]
  }
  readonly jsPoolSize?: number
  readonly origin?: string
  readonly htmlLimitedBots?: string
  readonly cache?: ServerCacheConfig
  readonly experimental?: {
    readonly useCache?: boolean
    readonly useCacheRemote?: ServerCacheLayerConfig
  }
  readonly mdx?: MdxPluginOptions
}

const DEFAULT_IMAGE_CONFIG = {
  remotePatterns: [],
  localPatterns: [],
  deviceSizes: DEFAULT_DEVICE_SIZES,
  imageSizes: DEFAULT_IMAGE_SIZES,
  formats: DEFAULT_FORMATS,
  qualityAllowlist: DEFAULT_QUALITY_LEVELS,
  minimumCacheTTL: DEFAULT_MINIMUM_CACHE_TTL,
}

function staticImageLocalPatterns(assetsDir: string): ReadonlyArray<{ readonly pathname: string }> {
  return [{ pathname: `/${normalizeAssetsDir(assetsDir)}/**` }]
}

function mergeLocalPatterns(
  patterns:
    | ReadonlyArray<{
        readonly pathname: string
        readonly search?: string
      }>
    | undefined,
  assetsDir: string,
): Array<{ pathname: string; search?: string }> {
  const merged: Array<{ pathname: string; search?: string }> = [...(patterns ?? [])]
  for (const pattern of staticImageLocalPatterns(assetsDir)) {
    if (!merged.some(entry => entry.pathname === pattern.pathname)) merged.push({ ...pattern })
  }
  return merged
}

const RARI_DIST_DIR = path.dirname(fileURLToPath(import.meta.url))
const RARI_PACKAGE_ROOT = path.dirname(RARI_DIST_DIR)

function resolveRuntimeDistFile(filename: string): string | null {
  const possiblePaths = [
    path.join(RARI_DIST_DIR, 'runtime', filename),
    path.join(RARI_DIST_DIR, '../runtime', filename),
  ]

  for (const filePath of possiblePaths) {
    if (fs.existsSync(filePath)) return filePath
  }

  return null
}

function isRariInternalFile(filePath: string): boolean {
  return filePath.startsWith(RARI_PACKAGE_ROOT)
}

async function writeImageConfig(
  projectRoot: string,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types RariOptions embeds optional peer option bags (oxc/mdx) that are not deeply readonly
  options: RariOptions,
  assetsDir = 'assets',
  outDir?: string,
): Promise<void> {
  const srcDir = path.join(projectRoot, 'src')
  const { getBinaryPath } = await import('@/cli/platform')
  const binaryPath = getBinaryPath()

  const scanImagesTimeoutMs = 60_000
  const result = spawnSync(binaryPath, ['scan-images', '--src', srcDir], {
    encoding: 'utf8',
    cwd: projectRoot,
    shell: false,
    timeout: scanImagesTimeoutMs,
  })

  if (result.error) {
    throw new Error(`Failed to scan for image usage: ${result.error.message}`)
  }

  if (result.signal) {
    throw new Error(`Failed to scan for image usage: process terminated by signal ${result.signal}`)
  }

  if (result.status !== 0) {
    throw new Error(
      `Failed to scan for image usage: ${result.stderr || result.stdout || `exit code ${result.status}`}`,
    )
  }

  let imageManifest: { images: Array<Record<string, unknown>> }
  try {
    imageManifest = { images: parseJsonArrayRecord(result.stdout, 'images') ?? [] }
  } catch (error) {
    const parseMessage =
      error instanceof SyntaxError ? error.message : errorMessage(error, String(error))
    const outputPreview = (result.stdout || result.stderr || '(empty)').slice(0, 500)
    throw new Error(
      `Failed to parse image scanner output as JSON: ${parseMessage}. Scanner output: ${outputPreview}`,
      { cause: error },
    )
  }

  const normalizedAssetsDir = normalizeAssetsDir(assetsDir)
  const resolvedOutDir = (() => {
    const candidate = outDir ?? options.serverBuild?.outDir ?? path.join(projectRoot, 'dist')
    return path.isAbsolute(candidate) ? candidate : path.resolve(projectRoot, candidate)
  })()
  const relativeOutDir = toPosixPath(path.relative(projectRoot, resolvedOutDir)) || 'dist'
  const imageConfig = {
    ...DEFAULT_IMAGE_CONFIG,
    ...options.images,
    assetsDir: normalizedAssetsDir,
    outDir: relativeOutDir,
    localPatterns: mergeLocalPatterns(options.images?.localPatterns, normalizedAssetsDir),
    preoptimizeManifest: imageManifest.images,
  }

  const serverDir = path.join(resolvedOutDir, 'server')
  if (!fs.existsSync(serverDir)) fs.mkdirSync(serverDir, { recursive: true })

  const configPath = path.join(serverDir, 'image.json')
  fs.writeFileSync(configPath, JSON.stringify(imageConfig))
}

export function defineRariOptions(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types RariOptions embeds optional peer option bags (oxc/mdx) that are not deeply readonly
  config: RariOptions,
): RariOptions {
  return config
}

export function rari(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types RariOptions embeds optional peer option bags (oxc/mdx) that are not deeply readonly
  options: RariOptions = {},
): RariPlugin[] {
  if (options.jsPoolSize != null) {
    const size = options.jsPoolSize
    if (!Number.isInteger(size) || size < 1 || !Number.isFinite(size)) {
      throw new Error(`jsPoolSize must be a finite positive integer; received ${String(size)}`)
    }
  }

  const componentTypeCache = new Map<string, 'client' | 'server' | 'unknown'>()
  const clientComponents = new Set<string>()
  const moduleAnalysisCache = new ModuleAnalysisCache()
  let devServerComponentBuilder: ServerComponentBuilder | null = null
  let rustServerProcess: ChildProcess | null = null

  let hmrCoordinator: HMRCoordinator | null = null
  const resolvedAlias: Record<string, string> = {}
  let resolvedAssetsDir = 'assets'
  let resolvedOutDir = path.join(process.cwd(), 'dist')
  let cachedMdxRegistryModule: string | null = null

  function invalidateMdxRegistryModuleCache(): void {
    cachedMdxRegistryModule = null
  }

  function buildMdxRegistryModule(): string {
    if (cachedMdxRegistryModule != null && cachedMdxRegistryModule !== '')
      return cachedMdxRegistryModule

    const projectRoot =
      options.projectRoot != null && options.projectRoot !== ''
        ? options.projectRoot
        : process.cwd()
    const entries = resolveMdxRegistryEntries({
      projectRoot,
      mdxOptions: options.mdx,
      alias: resolvedAlias,
      cache: moduleAnalysisCache,
    })

    cachedMdxRegistryModule = generateMdxRegistryModule(entries)
    return cachedMdxRegistryModule
  }

  function getComponentType(filePath: string): 'client' | 'server' | 'unknown' | undefined {
    return componentTypeCache.get(resolveModuleCachePath(filePath))
  }

  function clientReferenceIdForPath(absolutePath: string): string {
    const projectRoot =
      options.projectRoot != null && options.projectRoot !== ''
        ? options.projectRoot
        : process.cwd()
    const relative = toPosixPath(path.relative(projectRoot, absolutePath))
    if (relative.startsWith('..') || path.isAbsolute(relative)) return toPosixPath(absolutePath)
    return relative
  }

  function setComponentType(filePath: string, type: 'client' | 'server' | 'unknown'): void {
    componentTypeCache.set(resolveModuleCachePath(filePath), type)
  }

  function deleteComponentType(filePath: string): void {
    invalidateModuleCachePath(componentTypeCache, filePath)
  }

  function addTrackedClientComponent(filePath: string): void {
    clientComponents.add(resolveModuleCachePath(filePath))
  }

  function hasTrackedClientComponent(filePath: string): boolean {
    return clientComponents.has(resolveModuleCachePath(filePath))
  }

  function removeTrackedClientComponent(filePath: string): void {
    clientComponents.delete(filePath)
    try {
      clientComponents.delete(fs.realpathSync(filePath))
    } catch {
      clientComponents.delete(path.resolve(filePath))
    }
  }

  function getKnownClientComponentPaths(): Set<string> {
    const paths = new Set(clientComponents)

    if (devServerComponentBuilder) {
      for (const componentPath of devServerComponentBuilder.getClientComponentPaths())
        paths.add(componentPath)
    }

    return paths
  }

  function isServerComponent(filePath: string): boolean {
    if (filePath.includes('node_modules') || isRariInternalFile(filePath)) return false

    const resolvedPath = resolveModuleCachePath(filePath)

    try {
      const analysis = moduleAnalysisCache.get(filePath)
      return isServerComponentFromAnalysis(resolvedPath, analysis)
    } catch {
      return false
    }
  }

  function parseExportedNames(code: string, analysis?: ModuleAnalysis): string[] {
    try {
      const exportedNames = new Set(collectExportNames(code))
      if (analysis?.hasDefaultExport ?? hasDefaultExport(code)) exportedNames.add('default')
      return [...exportedNames]
    } catch {
      return []
    }
  }

  function transformServerModule(code: string, id: string): string {
    const projectRoot =
      options.projectRoot != null && options.projectRoot !== ''
        ? options.projectRoot
        : process.cwd()
    const moduleId = getComponentId(id, projectRoot)

    // Actions resolve by plain named export - no registerServerReference wrapper.
    return transformInlineServerActions(code, moduleId)?.code ?? code
  }

  function transformClientModule(code: string, id: string, analysis: ModuleAnalysis): string {
    const projectRoot =
      options.projectRoot != null && options.projectRoot !== ''
        ? options.projectRoot
        : process.cwd()
    const isServerComp = isServerComponent(id)

    if (analysis.topLevelUseServer) {
      const exportedNames = parseExportedNames(code, analysis)
      if (exportedNames.length === 0) return ''

      const moduleId = getComponentId(id, projectRoot)

      let newCode = 'import { createServerReference } from "rari/runtime/solid-call-server";\n'

      for (const name of exportedNames) {
        const refId = `${moduleId}#${name}`
        const refIdJson = JSON.stringify(refId)
        if (name === 'default') newCode += `export default createServerReference(${refIdJson});\n`
        else newCode += `export const ${name} = createServerReference(${refIdJson});\n`
      }

      return newCode
    }

    if (isServerComp) {
      console.warn(`[rari] Server component ${id} should not be imported in client bundle`)
      return ''
    }

    return code
  }

  function transformClientModuleForClient(
    code: string,
    _id: string,
    analysis: ModuleAnalysis,
  ): string {
    if (!analysis.topLevelUseClient) return code

    const exportedNames = parseExportedNames(code, analysis)
    if (exportedNames.length === 0) return code

    return code.replace(USE_CLIENT_DIRECTIVE_REGEX, '')
  }

  let rustServerReady = false

  async function checkRustServerHealth(): Promise<boolean> {
    const baseUrl = `http://localhost:${getRariServerPort()}`

    try {
      const healthResponse = await fetch(`${baseUrl}/_rari/health`, {
        signal: AbortSignal.timeout(1000),
      })
      const isHealthy = healthResponse.ok
      rustServerReady = isHealthy
      return isHealthy
    } catch {
      rustServerReady = false
      return false
    }
  }

  let rustServerReadyWait: Promise<boolean> | null = null

  async function waitForRustServerReady(timeoutMs: number): Promise<boolean> {
    if (await checkRustServerHealth()) return true

    rustServerReadyWait ??= (async () => {
      try {
        const deadline = Date.now() + timeoutMs
        let interval = 50

        while (Date.now() < deadline) {
          await new Promise(resolve => {
            setTimeout(resolve, Math.min(interval, deadline - Date.now()))
          })
          if (await checkRustServerHealth()) return true
          interval = Math.min(interval * 2, 500)
        }

        return false
      } finally {
        rustServerReadyWait = null
      }
    })()

    return rustServerReadyWait
  }

  const mainPlugin: Plugin = {
    name: 'rari',

    config(config: UserConfig, { command }) {
      // Layout owns <html>/<body>; client entry is virtual:rari-entry-client (no index.html).
      config.appType = 'custom'
      config.define ??= {}

      if (
        command === 'serve' ||
        (process.env.RARI_SERVER_URL != null && process.env.RARI_SERVER_URL !== '') ||
        (process.env.RARI_HOST != null && process.env.RARI_HOST !== '')
      ) {
        const rariServerPort = getRariServerPort()

        let serverUrl: string
        if (process.env.RARI_SERVER_URL != null && process.env.RARI_SERVER_URL !== '') {
          serverUrl = process.env.RARI_SERVER_URL
        } else if (process.env.RARI_HOST != null && process.env.RARI_HOST !== '') {
          const host = process.env.RARI_HOST.startsWith('http')
            ? process.env.RARI_HOST
            : `http://${process.env.RARI_HOST}`
          const hostnamePart = host.replace(HTTP_PROTOCOL_REGEX, '')
          serverUrl = hostnamePart.includes(':') ? host : `${host}:${rariServerPort}`
        } else {
          serverUrl = `http://localhost:${rariServerPort}`
        }

        config.define['import.meta.env.RARI_SERVER_URL'] = JSON.stringify(serverUrl)
      }

      const existingCssModules = typeof config.css?.modules === 'object' ? config.css.modules : {}
      config.css = {
        ...config.css,
        transformer: config.css?.transformer ?? ('lightningcss' as const),
        modules: { ...existingCssModules, pattern: RARI_CSS_MODULES_PATTERN } as CSSModulesOptions,
      }

      config.resolve ??= {}
      config.environments ??= {}

      config.environments.rsc = {
        consumer: 'server',
        resolve: {
          conditions: ['solid', 'node', 'import'],
        },
        build: {
          outDir: 'dist/server',
          write: false,
          copyPublicDir: false,
          emitAssets: true,
        },
        ...config.environments.rsc,
      }

      config.environments.ssr = {
        consumer: 'server',
        resolve: {
          conditions: ['solid', 'node', 'import'],
        },
        build: {
          outDir: 'dist/ssr',
          write: false,
          copyPublicDir: false,
          emitAssets: true,
        },
        ...config.environments.ssr,
      }

      config.environments.client = {
        consumer: 'client',
        resolve: {
          // solid-refresh (HMR) requires Solid's dev build, selected by the `development` condition.
          conditions:
            command === 'serve'
              ? ['solid', 'development', 'browser', 'import']
              : ['solid', 'browser', 'import'],
        },
        ...config.environments.client,
      }

      config.builder ??= {}
      config.builder.sharedPlugins = true
      config.builder.sharedConfigBuild = false

      config.optimizeDeps ??= {}
      config.optimizeDeps.include ??= []

      config.optimizeDeps.exclude ??= []
      if (!config.optimizeDeps.exclude.includes('rari')) config.optimizeDeps.exclude.push('rari')

      if (command === 'build') {
        for (const envName of ['rsc', 'ssr', 'client']) {
          const env = config.environments[envName]
          if (env.build != null) env.build.rolldownOptions ??= {}
        }
      }

      config.server ??= {}
      config.server.proxy ??= {}

      const serverPort = getRariServerPort()

      config.server.proxy['/api'] = {
        target: `http://localhost:${serverPort}`,
        changeOrigin: true,
        secure: false,
        ws: true,
      }

      config.server.proxy['/_rari'] = {
        target: `http://localhost:${serverPort}`,
        changeOrigin: true,
        secure: false,
        ws: true,
      }

      if (command === 'build') {
        config.build ??= {}
        config.build.rolldownOptions ??= {}

        config.build.rolldownOptions.input = {
          main: VIRTUAL_CLIENT_ENTRY,
        }

        config.build.rolldownOptions.output ??= {}

        const outputs = Array.isArray(config.build.rolldownOptions.output)
          ? config.build.rolldownOptions.output
          : [config.build.rolldownOptions.output]

        for (const output of outputs) {
          // Initialize codeSplitting as an object if it's not already
          if (output.codeSplitting !== false && typeof output.codeSplitting !== 'object') {
            output.codeSplitting = {}
          }

          // Only configure groups if codeSplitting is an object
          if (typeof output.codeSplitting === 'object') {
            output.codeSplitting.groups ??= []

            const userGroups = output.codeSplitting.groups

            output.codeSplitting.groups.push({
              name(moduleId: string) {
                if (moduleId.includes('node_modules')) {
                  for (const group of userGroups) {
                    if (group.test != null) {
                      let testResult = false
                      if (typeof group.test === 'function') {
                        testResult = Boolean(group.test(moduleId))
                      } else if (group.test instanceof RegExp) {
                        testResult = group.test.test(moduleId)
                      } else if (typeof group.test === 'string') {
                        testResult = moduleId.includes(group.test)
                      }

                      if (testResult) {
                        return null
                      }
                    }
                  }

                  return 'vendor'
                }

                return null
              },
            })
          }
        }
      }

      config.environments.client.build ??= {}
      config.environments.client.build.rolldownOptions ??= {}
      config.environments.client.build.rolldownOptions.input = {
        main: VIRTUAL_CLIENT_ENTRY,
      }

      config.environments.client.build.rolldownOptions.external ??= []

      return config
    },

    async buildStart() {
      resetClientHeadExtras()
      if (options.experimental?.useCache || options.experimental?.useCacheRemote) {
        try {
          await getUseCacheTransform()
        } catch (error) {
          this.error(error instanceof Error ? error : new Error(String(error)))
        }
      }
    },

    configResolved(config) {
      const paths = resolvePluginPaths(config)
      resolvedAssetsDir = paths.assetsDir
      resolvedOutDir = paths.outDir
      Object.assign(resolvedAlias, readViteAliases(config))
    },

    async transform(code, id) {
      if (id.endsWith('.mdx')) invalidateMdxRegistryModuleCache()

      if (/\.(?:tsx?|jsx?|mts|mjs)$/.test(id) && code.includes('defineMdxComponents')) {
        const mdxTransformed = transformDefineMdxComponents({
          code,
          id,
          projectRoot:
            options.projectRoot != null && options.projectRoot !== ''
              ? options.projectRoot
              : process.cwd(),
          resolvedAlias,
        })
        if (mdxTransformed != null && mdxTransformed !== '')
          return { code: mdxTransformed, map: null }
      }

      if (!TSX_EXT_REGEX.test(id)) return null

      let wasUseCacheTransformed = false
      if (options.experimental?.useCache || options.experimental?.useCacheRemote) {
        const transform = await getUseCacheTransform()
        if (transform) {
          const useCacheResult = transform(code, id)
          if (useCacheResult != null && useCacheResult !== '') {
            code = useCacheResult
            wasUseCacheTransformed = true
          }
        }
      }

      const environment = this.environment
      const moduleAnalysis =
        id.startsWith('\0') || id.includes('virtual:')
          ? analyzeModuleSource(code)
          : (() => {
              try {
                return moduleAnalysisCache.get(id)
              } catch {
                return analyzeModuleSource(code)
              }
            })()

      if (moduleAnalysis.topLevelUseServer) {
        setComponentType(id, 'server')

        if (environment.name === 'rsc') {
          return transformServerModule(code, id)
        }
        return transformClientModule(code, id, moduleAnalysis)
      }

      if (moduleAnalysis.topLevelUseClient) {
        setComponentType(id, 'client')
        addTrackedClientComponent(id)

        for (const importPath of moduleAnalysis.importSources) {
          if (
            !LOCAL_IMPORT_SOURCE_REGEX.test(importPath) &&
            !matchesAliasImport(importPath, resolvedAlias)
          ) {
            continue
          }

          const resolvedImportPath = resolveImportToFilePath(importPath, id, resolvedAlias)

          if (!fs.existsSync(resolvedImportPath)) continue

          const importedAnalysis = moduleAnalysisCache.get(resolvedImportPath)
          if (importedAnalysis.topLevelUseServer) continue

          setComponentType(resolvedImportPath, 'client')
          addTrackedClientComponent(resolvedImportPath)
        }

        return transformClientModuleForClient(code, id, moduleAnalysis)
      }

      if (
        environment.name !== 'rsc' &&
        environment.name !== 'ssr' &&
        (getComponentType(id) === 'client' || hasTrackedClientComponent(id))
      ) {
        return transformClientModuleForClient(code, id, moduleAnalysis)
      }

      function isClientBoundaryModule(filePath: string): boolean {
        if (!fs.existsSync(filePath)) return false
        try {
          return moduleAnalysisCache.get(filePath).topLevelUseClient
        } catch {
          return false
        }
      }

      function rewriteClientImportsForServerEnvironment(source: string, fileId: string): string {
        let modifiedCode = source
        const replacements: Array<{ start: number; end: number; replacement: string }> = []

        for (const imp of scanImportStatements(modifiedCode)) {
          if (imp.typeOnly || imp.sideEffectOnly) continue
          if (
            !LOCAL_IMPORT_SOURCE_REGEX.test(imp.source) &&
            !matchesAliasImport(imp.source, resolvedAlias)
          ) {
            continue
          }

          const resolvedImportPath = resolveImportToFilePath(imp.source, fileId, resolvedAlias)

          if (!isClientBoundaryModule(resolvedImportPath)) continue

          setComponentType(resolvedImportPath, 'client')
          addTrackedClientComponent(resolvedImportPath)

          const clientRefReplacement = buildSolidIslandReplacementFromImport(
            imp,
            clientReferenceIdForPath(resolvedImportPath),
          )
          if (clientRefReplacement.code === '') continue

          replacements.push({
            start: imp.start,
            end: imp.end,
            replacement: clientRefReplacement.code,
          })
        }

        if (replacements.length === 0) return modifiedCode

        for (const { start, end, replacement } of [...replacements].sort(
          (a, b) => b.start - a.start,
        )) {
          modifiedCode = modifiedCode.slice(0, start) + replacement + modifiedCode.slice(end)
        }

        return modifiedCode
      }

      if (isServerComponent(id)) {
        setComponentType(id, 'server')

        if (environment.name === 'rsc' || environment.name === 'ssr') {
          const serverTransformed = transformServerModule(code, id)
          return rewriteClientImportsForServerEnvironment(serverTransformed, id)
        } else {
          let clientTransformedCode = transformClientModule(code, id, moduleAnalysis)

          clientTransformedCode = `// HMR acceptance for server component
if (import.meta.hot) {
  import.meta.hot.accept();
  if (typeof globalThis !== 'undefined') {
    if (!globalThis['~rari']) globalThis['~rari'] = {};
    globalThis['~rari'].serverComponents = globalThis['~rari'].serverComponents || new Set();
    globalThis['~rari'].serverComponents.add(${JSON.stringify(id)});
  }
}

${clientTransformedCode}`

          return clientTransformedCode
        }
      }

      const cachedType = getComponentType(id)
      if (cachedType === 'server') {
        if (environment.name === 'rsc' || environment.name === 'ssr') {
          const serverTransformed = transformServerModule(code, id)
          return rewriteClientImportsForServerEnvironment(serverTransformed, id)
        } else {
          return transformClientModule(code, id, moduleAnalysis)
        }
      }
      if (cachedType === 'client') return transformClientModuleForClient(code, id, moduleAnalysis)

      setComponentType(id, 'unknown')

      let modifiedCode = code
      let hasServerImports = false
      const importingFileIsClient = id.includes('entry-client')
      const replacements: Array<{ start: number; end: number; replacement: string }> = []

      for (const imp of scanImportStatements(code)) {
        if (imp.typeOnly || imp.sideEffectOnly) continue
        if (
          !LOCAL_IMPORT_SOURCE_REGEX.test(imp.source) &&
          !matchesAliasImport(imp.source, resolvedAlias)
        ) {
          continue
        }

        const resolvedImportPath = resolveImportToFilePath(imp.source, id, resolvedAlias)

        const isClientComponent = isClientBoundaryModule(resolvedImportPath)

        if (isClientComponent) {
          setComponentType(resolvedImportPath, 'client')
          addTrackedClientComponent(resolvedImportPath)
        }

        if (
          !isClientComponent ||
          importingFileIsClient ||
          (environment.name !== 'rsc' && environment.name !== 'ssr')
        ) {
          continue
        }

        const clientRefReplacement = buildSolidIslandReplacementFromImport(
          imp,
          clientReferenceIdForPath(resolvedImportPath),
        )
        if (clientRefReplacement.code === '') continue

        replacements.push({
          start: imp.start,
          end: imp.end,
          replacement: clientRefReplacement.code,
        })
        hasServerImports = true
      }

      for (const { start, end, replacement } of [...replacements].sort((a, b) => b.start - a.start))
        modifiedCode = modifiedCode.slice(0, start) + replacement + modifiedCode.slice(end)

      if (hasServerImports) return modifiedCode

      if (wasUseCacheTransformed) return code

      return null
    },

    async configureServer(server) {
      const projectRoot = path.resolve(
        options.projectRoot != null && options.projectRoot !== ''
          ? options.projectRoot
          : process.cwd(),
      )
      const srcDir = path.join(projectRoot, 'src')
      await writeImageConfig(projectRoot, options, resolvedAssetsDir, resolvedOutDir)

      const discoverAndRegisterComponents = async () => {
        try {
          const builder = new ServerComponentBuilder(projectRoot, {
            outDir: resolvedOutDir,
            rscDir: 'server',
            manifestPath: 'server/manifest.json',
            serverConfigPath: 'server/config.json',
            alias: resolvedAlias,
            assetsDir: resolvedAssetsDir,
            csp: options.csp,
            cacheControl: options.cacheControl,
            cache: options.cache,
            action: options.action,
            jsPoolSize: options.jsPoolSize,
            origin: options.origin,
            htmlLimitedBots: options.htmlLimitedBots,
            experimental: options.experimental,
            moduleAnalysisCache,
          })

          builder.setViteBuilder(
            await getOrCreateViteEmitBuilder({
              root: projectRoot,
              configFile: server.config.configFile,
              logLevel: 'error',
            }),
          )

          devServerComponentBuilder = builder

          hmrCoordinator ??= new HMRCoordinator(builder, getRariServerPort())

          if (fs.existsSync(srcDir)) {
            const scanResult = scanDirectory(srcDir, builder, Object.values(resolvedAlias))

            if (scanResult.serverComponentPaths.length > 0) {
              server.ws.send({
                type: 'custom',
                event: 'rari:server-components-registry',
                data: { serverComponents: scanResult.serverComponentPaths },
              })
            }
          }

          const components = await builder.getTransformedComponentsForDevelopment()

          const baseUrl = `http://localhost:${getRariServerPort()}`

          await Promise.all(
            components.map(async component => {
              try {
                const isAppRouterComponent = component.id.startsWith('app/')
                if (isAppRouterComponent) return

                if (component.isAction) return

                const registerResponse = await fetch(`${baseUrl}/_rari/register`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    component_id: component.id,
                    component_code: component.code,
                  }),
                })

                if (!registerResponse.ok) {
                  const errorText = await registerResponse.text()
                  throw new Error(`HTTP ${registerResponse.status}: ${errorText}`)
                }
              } catch (error) {
                console.error(
                  `[rari] Runtime: Failed to register component ${component.id}:`,
                  errorMessage(error, String(error)),
                )
              }
            }),
          )
        } catch (error) {
          console.error(
            '[rari] Runtime: Component discovery failed:',
            errorMessage(error, String(error)),
          )
        }
      }

      const ensureClientComponentsRegistered = async () => {
        try {
          const baseUrl = `http://localhost:${getRariServerPort()}`

          const clientComponentFiles = getKnownClientComponentPaths()

          await Promise.all(
            [...clientComponentFiles].map(async componentPath => {
              const relativePath = path.relative(process.cwd(), componentPath)
              const componentName = path.basename(componentPath).replace(EXTENSION_REGEX, '')

              try {
                await fetch(`${baseUrl}/_rari/register-client`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    component_id: componentName,
                    file_path: relativePath,
                    export_name: 'default',
                  }),
                })
              } catch (error) {
                console.error(
                  `[rari] Runtime: Failed to pre-register client component ${componentName}:`,
                  error,
                )
              }
            }),
          )
        } catch (error) {
          console.error('[rari] Runtime: Failed to pre-register client components:', error)
        }
      }

      const startRustServer = async () => {
        if (rustServerProcess) return

        const { getBinaryPath, getInstallationInstructions } = await import('@/cli/platform')

        let binaryPath: string
        try {
          binaryPath = getBinaryPath()
        } catch (error) {
          console.error('rari binary not found')
          console.error(`   ${errorMessage(error, String(error))}`)
          console.error(getInstallationInstructions())
          return
        }

        const serverPort = getRariServerPort()
        const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development'

        const vitePort = server.config.server.port
        const origin = options.origin?.trim().replace(/\/+$/, '')
        const envOrigin = process.env.RARI_ORIGIN?.trim().replace(/\/+$/, '')
        const layoutCssHrefs = collectLayoutCssDevHrefs(projectRoot, resolvedAlias)

        const args = ['--mode', mode, '--port', serverPort.toString(), '--host', '127.0.0.1']

        rustServerProcess = spawn(binaryPath, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          cwd: projectRoot,
          env: {
            ...process.env,
            RUST_LOG:
              process.env.RUST_LOG != null && process.env.RUST_LOG !== ''
                ? process.env.RUST_LOG
                : 'error',
            RARI_VITE_PORT: vitePort.toString(),
            ...(layoutCssHrefs.length > 0 ? { RARI_DEV_LAYOUT_CSS: layoutCssHrefs.join(',') } : {}),
            // Dev starts the binary before config.json is written; pass pool size / origin / bots via env.
            ...(options.jsPoolSize != null &&
            (process.env.RARI_JS_POOL_SIZE == null || process.env.RARI_JS_POOL_SIZE === '')
              ? { RARI_JS_POOL_SIZE: String(options.jsPoolSize) }
              : {}),
            ...(origin != null && origin !== '' && (envOrigin == null || envOrigin === '')
              ? { RARI_ORIGIN: origin }
              : {}),
            ...(options.htmlLimitedBots != null &&
            (process.env.RARI_HTML_LIMITED_BOTS == null ||
              process.env.RARI_HTML_LIMITED_BOTS === '')
              ? { RARI_HTML_LIMITED_BOTS: options.htmlLimitedBots }
              : {}),
          },
        })

        rustServerProcess.stdout?.on('data', (data: Buffer) => {
          const output = data.toString().trim()
          if (output) console.error(output)
        })

        rustServerProcess.stderr?.on('data', (data: Buffer) => {
          const output = data.toString().trim()
          if (output && !output.includes('warning')) console.error(output)
        })

        rustServerProcess.on('error', (error: Error) => {
          rustServerReady = false
          console.error('Failed to start rari server:', error.message)
          if (error.message.includes('ENOENT')) {
            console.error('   Binary not found. Please ensure rari is properly installed.')
          }
        })

        rustServerProcess.on('exit', (code: number, signal: string) => {
          rustServerProcess = null
          rustServerReady = false
          if (signal) console.error(`rari server stopped by signal ${signal}`)
          else if (code === 0) console.error('rari server stopped successfully')
          else if (code) console.error(`rari server exited with code ${code}`)
        })

        const serverReady = await waitForRustServerReady(10000)

        if (serverReady) {
          await discoverAndRegisterComponents()
          await ensureClientComponentsRegistered()
        } else {
          console.error('Server failed to become ready for component registration')
        }
      }

      const handleServerComponentHMR = async (filePath: string) => {
        try {
          if (!isServerComponent(filePath)) return

          if (devServerComponentBuilder == null) await discoverAndRegisterComponents()

          const builder = devServerComponentBuilder
          if (builder == null) return

          const code = moduleAnalysisCache.getSource(filePath)
          builder.addServerComponent(filePath, code)

          const affectedFiles = walkImporters(builder.getImportGraph(), [filePath])
          affectedFiles.add(filePath)
          const components = await builder.getTransformedComponentsForDevelopment(file =>
            affectedFiles.has(file),
          )

          if (components.length === 0) return

          const baseUrl = `http://localhost:${getRariServerPort()}`

          await Promise.all(
            components.map(async component => {
              try {
                const registerResponse = await fetch(`${baseUrl}/_rari/register`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    component_id: component.id,
                    component_code: component.code,
                  }),
                })

                if (!registerResponse.ok) {
                  const errorText = await registerResponse.text()
                  throw new Error(`HTTP ${registerResponse.status}: ${errorText}`)
                }
              } catch (error) {
                console.error(
                  '[rari] Failed to register component',
                  `${component.id}:`,
                  errorMessage(error, String(error)),
                )
              }
            }),
          )
        } catch (error) {
          console.error(
            '[rari] Targeted HMR failed for',
            `${filePath}:`,
            errorMessage(error, String(error)),
          )
        }
      }

      startRustServer().catch((error: unknown) => {
        console.error('[rari] Failed to start Rust server:', error)
      })

      server.middlewares.use((req, res, next) => {
        void (async () => {
          const acceptHeader = req.headers.accept
          const method = req.method ?? 'GET'
          const url = req.url ?? ''
          const pathname = pathnameFromUrl(url)
          const isRscRequest =
            acceptHeader != null && acceptHeader !== '' && acceptHeader.includes('text/x-component')
          const isDocumentRequest =
            (method === 'GET' || method === 'HEAD') &&
            acceptHeader?.includes('text/html') &&
            !pathname.startsWith('/@') &&
            !isReservedRoutePrefix(pathname, '/node_modules') &&
            !isReservedRoutePrefix(pathname, '/api') &&
            !isReservedRoutePrefix(pathname, '/_rari') &&
            !isReservedRoutePrefix(pathname, '/vite-server') &&
            !isLikelyStaticAssetPath(pathname)

          if (
            (isRscRequest || isDocumentRequest) &&
            url !== '' &&
            !isReservedRoutePrefix(pathname, '/api') &&
            !isReservedRoutePrefix(pathname, '/rsc')
          ) {
            if (!rustServerReady) {
              const ready = await waitForRustServerReady(10000)

              if (!ready) {
                console.error(
                  `[rari] Rust server not ready, cannot proxy ${isRscRequest ? 'RSC' : 'HTML'} request`,
                )
                if (!res.headersSent) {
                  res.statusCode = 503
                  res.end('Server not ready')
                }

                return
              }
            }

            const serverPort = getRariServerPort()

            const targetUrl = `http://localhost:${serverPort}${url}`

            try {
              const headers: Record<string, string> = {}
              for (const [key, value] of Object.entries(req.headers)) {
                if (typeof value === 'string') headers[key] = value
                else if (Array.isArray(value)) headers[key] = value.join(',')
              }
              headers.host = `localhost:${serverPort}`
              headers['accept-encoding'] = 'identity'

              const hasBody = method !== 'GET' && method !== 'HEAD'
              const body = hasBody
                ? await readRequestBodyAsBlob(req, PROXY_BODY_MAX_BYTES)
                : undefined

              const response = await fetch(targetUrl, {
                method,
                headers,
                ...(body != null ? { body } : {}),
              })

              res.statusCode = response.status
              response.headers.forEach((value, key) => {
                if (key.toLowerCase() !== 'content-encoding') res.setHeader(key, value)
              })

              if (method === 'HEAD' || !response.body) {
                res.end()
                return
              }

              const reader = response.body.getReader()

              try {
                let streamDone = false
                while (!streamDone) {
                  const { done, value } = await reader.read()
                  streamDone = done
                  if (!streamDone && value != null) res.write(Buffer.from(value))
                }
                res.end()
              } catch (streamError) {
                console.error('[rari] Stream error:', streamError)
                if (!res.headersSent) res.statusCode = 500
                res.end()
              }

              return
            } catch (error) {
              const statusCode =
                isRecord(error) && typeof error.statusCode === 'number'
                  ? error.statusCode
                  : undefined
              if (statusCode === 413) {
                if (!res.headersSent) {
                  res.statusCode = 413
                  res.end('Request Entity Too Large')
                }
                return
              }
              console.error(
                `[rari] Failed to proxy ${isRscRequest ? 'RSC' : 'HTML'} request:`,
                error,
              )
              if (!res.headersSent) {
                res.statusCode = 500
                res.end('Internal Server Error')
              }

              return
            }
          }

          next()
        })()
      })

      server.watcher.on('change', filePath => {
        void (async () => {
          if (TSX_EXT_REGEX.test(filePath)) {
            deleteComponentType(filePath)
            removeTrackedClientComponent(filePath)
            moduleAnalysisCache.invalidate(filePath)
          }

          if (
            TSX_EXT_REGEX.test(filePath) &&
            isPathInside(filePath, srcDir) &&
            isServerComponent(filePath)
          ) {
            server.ws.send({
              type: 'custom',
              event: 'rari:register-server-component',
              data: { filePath },
            })
            await handleServerComponentHMR(filePath)
          }
        })()
      })

      server.middlewares.use('/api/vite/hmr-transform', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method Not Allowed')
          return
        }

        void (async () => {
          try {
            const body = await readRequestText(req)
            const bodyRecord = parseJsonRecord(body)
            const filePath =
              bodyRecord && typeof bodyRecord.filePath === 'string'
                ? bodyRecord.filePath
                : undefined

            if (filePath == null || filePath === '') {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'filePath is required' }))
              return
            }

            await handleServerComponentHMR(filePath)

            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(
              JSON.stringify({
                success: true,
                filePath,
                message: 'Component transformation completed',
              }),
            )
          } catch (error) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(
              JSON.stringify({
                success: false,
                error: errorMessage(error, String(error)),
              }),
            )
          }
        })()
      })

      server.httpServer?.on('close', () => {
        clearViteEmitBuilder(projectRoot)
        if (devServerComponentBuilder != null) {
          devServerComponentBuilder.setViteBuilder(null)
          devServerComponentBuilder = null
        }

        if (hmrCoordinator) {
          hmrCoordinator.dispose()
          hmrCoordinator = null
        }

        if (rustServerProcess) {
          const proc = rustServerProcess
          rustServerProcess = null
          rustServerReady = false

          let exited = false
          const forceKillTimer = setTimeout(() => {
            if (!exited) proc.kill('SIGKILL')
          }, 5000)
          forceKillTimer.unref()
          proc.once('exit', () => {
            exited = true
            clearTimeout(forceKillTimer)
          })
          proc.kill('SIGTERM')
          return
        }

        rustServerReady = false
      })
    },

    resolveId(id, importer) {
      if (id === 'virtual:rari-entry-client' || id === 'virtual:rari-entry-client.ts')
        return 'virtual:rari-entry-client.ts'
      if (isMdxRegistryModuleId(id)) return 'virtual:rari-mdx-components.ts'
      if (id === 'virtual:rari-mdx-components' || id === 'virtual:rari-mdx-components.ts')
        return 'virtual:rari-mdx-components.ts'

      if (
        importer != null &&
        importer !== '' &&
        importer.startsWith('virtual:') &&
        id.startsWith('./')
      ) {
        const runtimeFile = resolveRuntimeDistFile(path.basename(id))
        if (runtimeFile != null && runtimeFile !== '') return runtimeFile
      }

      if (
        importer != null &&
        importer !== '' &&
        importer.startsWith('virtual:') &&
        id.startsWith('../')
      ) {
        const currentFileUrl = import.meta.url
        const currentFilePath = fileURLToPath(currentFileUrl)
        const currentDir = path.dirname(currentFilePath)

        let runtimeDir: string | null = null
        const possibleRuntimeDirs = [
          path.join(currentDir, 'runtime'),
          path.join(currentDir, '../runtime'),
        ]

        for (const dir of possibleRuntimeDirs) {
          if (fs.existsSync(dir)) {
            runtimeDir = dir
            break
          }
        }

        if (runtimeDir != null && runtimeDir !== '') {
          const chunkPath = path.join(runtimeDir, id)
          if (fs.existsSync(chunkPath)) return chunkPath

          const altChunkPath = path.join(runtimeDir, '../dist', path.basename(id))
          if (fs.existsSync(altChunkPath)) return altChunkPath
        } else {
          console.warn(
            `[rari] Runtime directory not found, attempting fallback resolution for virtual import.\n` +
              `  Importer: ${importer}\n` +
              `  ID: ${id}\n` +
              `  Current Dir: ${currentDir}\n` +
              `  Hint: Runtime lookup failed, trying currentDir as fallback`,
          )
        }

        const chunkPath = path.join(currentDir, id)
        if (fs.existsSync(chunkPath)) return chunkPath

        const altChunkPath = path.join(currentDir, '../dist', path.basename(id))
        if (fs.existsSync(altChunkPath)) return altChunkPath
      }

      if (process.env.NODE_ENV === 'production') {
        try {
          const resolvedPath = path.resolve(id)
          if (fs.existsSync(resolvedPath) && isServerComponent(resolvedPath))
            return { id, external: true }
        } catch (err) {
          if (getErrnoCode(err) !== 'ENOENT') {
            console.warn('[rari] Unexpected error resolving server component:', id, err)
          }
        }
      }

      return null
    },

    load(id) {
      if (TSX_EXT_REGEX.test(id)) {
        const environment = this.environment

        if (environment.name === 'client') {
          try {
            const analysis = moduleAnalysisCache.get(id)
            if (analysis.topLevelUseServer)
              return transformClientModule(moduleAnalysisCache.getSource(id), id, analysis)
          } catch {
            // File doesn't exist or can't be read
          }
        }
      }

      if (id === 'virtual:rari-mdx-components.ts') return buildMdxRegistryModule()

      if (id === 'virtual:rari-entry-client.ts') {
        const projectRoot =
          options.projectRoot != null && options.projectRoot !== ''
            ? options.projectRoot
            : process.cwd()
        const srcDir = path.join(projectRoot, 'src')
        const islands = new Set([
          ...getKnownClientComponentPaths(),
          ...collectClientComponentPaths(
            normalizeScanDirs(srcDir, Object.values(resolvedAlias)),
            moduleAnalysisCache,
          ),
        ])
        const loaders = [...islands]
          .filter(componentPath => {
            try {
              return moduleAnalysisCache.get(componentPath).topLevelUseClient
            } catch {
              return false
            }
          })
          .map(
            componentPath =>
              `  ${JSON.stringify(clientReferenceIdForPath(componentPath))}: () => import(${JSON.stringify(toPosixPath(componentPath))}),`,
          )
          .join('\n')
        return `import { hydrateAllSolidIslands } from 'rari/runtime/entry-client-solid'
globalThis.__RARI_SOLID_ISLAND_LOADERS__ = {
${loaders}
}
hydrateAllSolidIslands()
`
      }

      if (id.endsWith('.mjs') && fs.existsSync(id)) {
        try {
          const projectRoot =
            options.projectRoot != null && options.projectRoot !== ''
              ? options.projectRoot
              : process.cwd()
          const realId = fs.realpathSync(id)
          const relativeToRoot = path.relative(projectRoot, realId)

          const isInProjectRoot =
            !relativeToRoot.startsWith('..') && !path.isAbsolute(relativeToRoot)
          const isInNodeModules = realId.includes(`${path.sep}node_modules${path.sep}`)

          const isInAllowedWorkspacePackage =
            realId.includes(`${path.sep}packages${path.sep}rari${path.sep}`) ||
            realId.includes(`${path.sep}packages${path.sep}use-cache${path.sep}`) ||
            realId.includes(`${path.sep}node_modules${path.sep}rari${path.sep}`) ||
            realId.includes(
              `${path.sep}node_modules${path.sep}@rari${path.sep}use-cache${path.sep}`,
            )

          if (isInProjectRoot || isInNodeModules || isInAllowedWorkspacePackage)
            return fs.readFileSync(id, 'utf-8')

          console.warn(
            `[rari] Refusing to load .mjs file outside project root and node_modules: ${id}`,
          )
          return null
        } catch (err) {
          console.warn(`[rari] Error validating .mjs file path: ${id}`, err)
          return null
        }
      }

      return undefined
    },

    async handleHotUpdate({ file, server }) {
      clearFileResolverCache()

      if (file.endsWith('.mdx')) invalidateMdxRegistryModuleCache()

      const isJsxFile = TSX_EXT_REGEX.test(file)

      if (!isJsxFile) return undefined

      deleteComponentType(file)
      removeTrackedClientComponent(file)
      moduleAnalysisCache.invalidate(file)
      invalidateMdxRegistryModuleCache()

      if (file.includes('/dist/') || file.includes('\\dist\\')) return []

      const isAppRouterFile = file.includes('/app/') || file.includes('\\app\\')
      const hasExtension = (fileName: string, baseName: string) =>
        fileName.endsWith(`${baseName}.tsx`) ||
        fileName.endsWith(`${baseName}.jsx`) ||
        fileName.endsWith(`${baseName}.ts`) ||
        fileName.endsWith(`${baseName}.js`)

      const SPECIAL_ROUTE_FILE_BASES = [
        'page',
        'layout',
        'template',
        'loading',
        'error',
        'not-found',
      ] as const
      const isSpecialRouteFile = SPECIAL_ROUTE_FILE_BASES.some(base => hasExtension(file, base))

      if (isAppRouterFile && isSpecialRouteFile) {
        if (hmrCoordinator) {
          try {
            await hmrCoordinator.rebuildAndNotifyNow(file, server)
          } catch (error) {
            console.error(
              '[rari] HMR: Failed to rebuild app router file',
              `${file}:`,
              errorMessage(error, String(error)),
            )
          }
        }
        return undefined
      }

      // Islands and server components are both baked into the server bundles that produce the
      // hydratable HTML, so any change rebuilds those bundles; the client reloads once they are
      // registered (see entry-client-solid.ts).
      if (hmrCoordinator) await hmrCoordinator.handleServerComponentUpdate(file, server)

      return []
    },

    generateBundle(_options, bundle) {
      if (this.environment.name !== 'client') return

      const head = buildClientHeadFromBundle(bundle)

      this.emitFile({
        type: 'asset',
        fileName: CLIENT_HEAD_FILE,
        source: head,
      })
    },

    async writeBundle() {
      const projectRoot =
        options.projectRoot != null && options.projectRoot !== ''
          ? options.projectRoot
          : process.cwd()
      await writeImageConfig(projectRoot, options, resolvedAssetsDir, resolvedOutDir)
    },
  }

  const serverBuildPlugin = createServerBuildPlugin({
    ...options.serverBuild,
    csp: options.csp,
    cacheControl: options.cacheControl,
    cache: options.cache,
    action: options.action,
    jsPoolSize: options.jsPoolSize,
    origin: options.origin,
    htmlLimitedBots: options.htmlLimitedBots,
    experimental: options.experimental,
    moduleAnalysisCache,
    mdx: options.mdx,
  })

  const plugins: Plugin[] = [
    mainPlugin,
    createSolidCompilerPlugin(),
    createSilenceDirectiveLogsPlugin(),
    createStaticImagePlugin(),
    createFontPlugin(),
    serverBuildPlugin,
  ]

  if (options.proxy !== false) plugins.push(rariProxy(options.proxy ?? {}))

  if (options.router !== false) plugins.push(rariRouter(options.router ?? {}))

  return toRariPlugins(plugins)
}

export function defineRariConfig(
  config: UserConfig & { readonly plugins?: readonly RariPlugin[] },
): UserConfig {
  return {
    ...config,
    plugins: [rari(), ...(config.plugins ?? [])],
  }
}

export type { RariPlugin } from './plugin/types'

export type Request = globalThis.Request
export type Response = globalThis.Response

export type {
  ServerActionConfig,
  ServerCacheConfig,
  ServerCacheControlConfig,
  ServerCacheLayerConfig,
  ServerConfig,
  ServerCSPConfig,
  ServerUseCacheConfig,
} from './server/config'

// oxlint-disable-next-line typescript/no-useless-empty-export side-effect import of ambient declarations
export type {} from '@/ambient'

export { rariProxy } from '@/proxy/build/vite-plugin'

export type { ProxyPluginOptions } from '@/proxy/build/vite-plugin'

export type {
  CookieOptions,
  ProxyConfig,
  ProxyFunction,
  ProxyMatcher,
  ProxyModule,
  ProxyResult,
  RariFetchEvent,
  RariURL,
  RequestCookies,
  ResponseCookies,
} from '@/proxy/http/types'

export type { ApiRouteHandlers, RouteContext, RouteHandler } from '@/router/build/api-routes'

export { ApiResponse } from '@/router/build/api-routes'

export {
  clearPropsCache,
  clearPropsCacheForComponent,
  extractMetadata,
  extractServerProps,
  extractServerPropsWithCache,
  extractStaticParams,
  hasServerSideDataFetching,
} from '@/router/build/props-extractor'

export type {
  MetadataResult,
  ServerSidePropsResult,
  StaticParamsResult,
} from '@/router/build/props-extractor'

export { generateAppRouteManifest } from '@/router/build/routes'

export type {
  AppRouteEntry,
  AppRouteManifest,
  AppRouteMatch,
  ErrorEntry,
  ErrorProps,
  GenerateMetadata,
  GenerateStaticParams,
  LayoutEntry,
  LayoutProps,
  LoadingEntry,
  NotFoundEntry,
  PageProps,
  RouteSegment,
  RouteSegmentType,
  TemplateEntry,
} from '@/router/build/types'

export type { Metadata } from '@/router/build/types'

export { rariRouter } from '@/router/build/vite-plugin'

export type {
  Robots,
  RobotsRule,
  Sitemap,
  SitemapEntry,
  SitemapImage,
  SitemapVideo,
} from '@/router/metadata/types'
