/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access, typescript/no-unsafe-argument, typescript/use-unknown-in-catch-callback-variable -- untyped CommonJS-loaded babel/preset in a standalone Node helper */
// Renders the fixture app's Counter island to HTML in plain Node using
// solid-js's *server* build (default `node` resolution) and the same
// babel-preset-solid `generate: 'ssr'` output the real build produces.
// Prints `{ html, renderId }` JSON to stdout. Run from the repo root.
import fs from 'node:fs'
import { createRequire, stripTypeScriptTypes } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const DRIVER = `import { renderToStream } from 'solid-js/web'
import { createComponent } from 'solid-js'
import Counter from './Counter.ssr.mjs'

// renderToStream (what the Rust runtime uses), not renderToString: the latter
// renders hydration-free (no data-hk keys), so it can't be hydrated.
export function render(renderId) {
  return new Promise((resolve, reject) => {
    let html = ''
    try {
      renderToStream(() => createComponent(Counter, { label: 'clicks' }), { renderId }).pipe({
        write(chunk) { html += chunk },
        end() { resolve({ html, renderId }) },
      })
    } catch (error) { reject(error) }
  })
}
`

async function main() {
  const appRoot = path.resolve('test/fixtures/solid-app')
  const require = createRequire(path.join(appRoot, 'package.json'))
  const babel = require('@babel/core')
  const preset = require('babel-preset-solid')

  const source = fs.readFileSync(path.join(appRoot, 'src/components/Counter.tsx'), 'utf-8')
  const compiled = babel.transformSync(source, {
    filename: 'Counter.tsx',
    configFile: false,
    babelrc: false,
    parserOpts: { plugins: ['jsx', 'typescript'] },
    presets: [[preset, { generate: 'ssr', hydratable: true }]],
  }).code

  // The compiled module and its driver are written to disk and imported as ESM so
  // `solid-js`/`solid-js/web` resolve once, to the same (ESM server) build the
  // compiled code uses - resolving them via `require.resolve` here would pick the
  // CJS build, giving a second copy of solid-js's `sharedConfig` and silently
  // dropping every `data-hk` key.
  const tmpDir = path.join(appRoot, '.tmp')
  fs.mkdirSync(tmpDir, { recursive: true })
  fs.writeFileSync(path.join(tmpDir, 'Counter.ssr.mjs'), stripTypeScriptTypes(compiled))
  const driver = path.join(tmpDir, 'run.ssr.mjs')
  fs.writeFileSync(driver, DRIVER)

  const { render } = await import(pathToFileURL(driver).href)
  process.stdout.write(JSON.stringify(await render(process.argv[2] ?? 'i0')))
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
