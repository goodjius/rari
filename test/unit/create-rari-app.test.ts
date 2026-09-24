import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

const TEMPLATE = path.resolve(
  import.meta.dirname,
  '../../packages/create-rari-app/templates/default',
)

function listFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .sort()
}

describe('create-rari-app default template', () => {
  const files = listFiles(TEMPLATE)

  it('ships the Solid app skeleton', () => {
    expect(files).toEqual(
      expect.arrayContaining([
        'gitignore',
        'package.json',
        'tsconfig.json',
        'vite.config.ts',
        'src/app/layout.tsx',
        'src/app/page.tsx',
        'src/app/about/page.tsx',
        'src/components/Counter.tsx',
        'src/components/ServerTime.tsx',
      ]),
    )
  })

  it('depends on solid-js and rari, not React', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(TEMPLATE, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    const all = { ...pkg.dependencies, ...pkg.devDependencies }

    expect(pkg.dependencies).toHaveProperty('solid-js')
    expect(pkg.dependencies).toHaveProperty('seroval')
    expect(pkg.dependencies).toHaveProperty('rari')
    expect(Object.keys(all).filter(name => name.includes('react'))).toEqual([])
  })

  it('has no React references in any template file', () => {
    for (const file of files) {
      const content = fs.readFileSync(path.join(TEMPLATE, file), 'utf8')
      expect(content.toLowerCase(), file).not.toMatch(/\breact\b|classname=|from 'react'/)
    }
  })

  it('compiles JSX with Solid and marks the counter as a client island', () => {
    const tsconfig = fs.readFileSync(path.join(TEMPLATE, 'tsconfig.json'), 'utf8')
    expect(tsconfig).toContain('"jsxImportSource": "solid-js"')

    const counter = fs.readFileSync(path.join(TEMPLATE, 'src/components/Counter.tsx'), 'utf8')
    expect(counter.trimStart().startsWith("'use client'")).toBe(true)
  })

  it('keeps the placeholders the CLI substitutes', () => {
    const layout = fs.readFileSync(path.join(TEMPLATE, 'src/app/layout.tsx'), 'utf8')
    expect(layout).toContain('{{PROJECT_NAME}}')
  })
})
