import { collectExportNames } from '@rari/vite/analysis/directives'
import {
  buildGlobalClientComponentWrapper,
  buildGlobalClientNamespaceWrapper,
} from '@rari/vite/transform/component-global'
import { transformInlineServerActions } from '@rari/vite/transform/inline-server-action'
import { describe, expect, it } from 'vite-plus/test'

describe('collectExportNames', () => {
  it('collects default and named declarations', () => {
    expect(
      collectExportNames(`export default function Button() {}\nexport function Card() {}\n`),
    ).toEqual(['default', 'Card'])
  })

  it('collects export { a as b } lists', () => {
    expect(collectExportNames(`const a = 1\nconst b = 2\nexport { a as Button, b }\n`)).toEqual([
      'Button',
      'b',
    ])
  })

  it('ignores export-like text in comments and strings', () => {
    expect(
      collectExportNames(`
// export function Fake() {}
/* export default function AlsoFake() {} */
const msg = "export function Nope() {}"
export function Real() {}
`),
    ).toEqual(['Real'])
  })

  it('collects export * as namespace names', () => {
    expect(collectExportNames(`export * as ns from './mod'\nexport function Real() {}\n`)).toEqual([
      'ns',
      'Real',
    ])
  })

  it('ignores bare export * re-exports', () => {
    expect(collectExportNames(`export * from './mod'\n`)).toEqual([])
  })
})

describe('component global wrappers', () => {
  it('builds a named-export wrapper that reads the export off the registry module', () => {
    const code = buildGlobalClientComponentWrapper('TheCard', 'components/ui', 'Card')

    expect(code).toContain('Component["Card"]')
    expect(code).toContain('globalThis[\'~clientComponents\']?.["components/ui"]')
  })

  it('builds a namespace wrapper', () => {
    expect(buildGlobalClientNamespaceWrapper('UI', 'components/ui')).toContain(
      'globalThis[\'~clientComponents\']?.["components/ui"]',
    )
  })
})

describe('transformInlineServerActions', () => {
  it('returns null when there is no inline use server function', () => {
    expect(
      transformInlineServerActions(`export async function Page() { return null }\n`, 'page'),
    ).toBeNull()
  })

  it('hoists a nested declaration and keeps its local name', () => {
    const input = `import { persist } from './db'
export default function Page() {
  async function save(formData) {
    'use server'
    await persist(formData)
  }
  return save
}
`

    const result = transformInlineServerActions(input, 'src/app/page')
    expect(result).not.toBeNull()
    expect(result!.actionNames[0]).toBe('$$ACTION_0_save')
    expect(result!.code).toContain('const save = $$ACTION_0_save')
    expect(result!.code).toContain('export async function $$ACTION_0_save(formData)')
    expect(result!.code).toContain('await persist(formData)')
    expect(result!.code).not.toContain("'use server'")
    expect(result!.code).not.toContain('registerServerReference')
  })

  it('rejects actions that capture enclosing variables', () => {
    const input = `import { db } from './db'
export default async function Page({ id }) {
  async function like() {
    "use server"
    await db.like(id)
  }
  return like
}
`

    expect(() => transformInlineServerActions(input, 'page')).toThrow(/captures id/)
  })

  it('hoists async arrow actions', () => {
    const input = `import { save } from './db'
export default function Page() {
  const action = async (formData) => {
    'use server'
    await save(formData)
  }
  return action
}
`

    const result = transformInlineServerActions(input, 'page')
    expect(result!.code).toContain('const action = $$ACTION_0_anonymous_server_function')
    expect(result!.code).toContain(
      'export async function $$ACTION_0_anonymous_server_function(formData)',
    )
  })

  it('ignores string literals and comments when collecting free vars', () => {
    const input = `import { db } from './db'
export default async function Page() {
  async function save(formData) {
    'use server'
    // mentions leakedVar in a comment
    await db.write(formData, "alsoLeaked")
  }
  return save
}
`

    const result = transformInlineServerActions(input, 'page')
    expect(result!.code).toContain('async function $$ACTION_0_save(formData)')
  })

  it('emits export default for a directly default-exported inline action', () => {
    const input = `import { db } from './db'
export default async function save(formData) {
  'use server'
  await db.write(formData)
}
`

    const result = transformInlineServerActions(input, 'page')
    expect(result!.rewrittenExportNames).toEqual(['default'])
    expect(result!.code).toContain('export default $$ACTION_0_save')
    expect(result!.code).toContain('async function $$ACTION_0_save(formData)')
    expect(result!.code).not.toContain('export async function $$ACTION_0_save')
  })

  it('keeps the exported binding of arrow actions', () => {
    const input = `import { db } from './db'
export const save = async (formData) => {
  'use server'
  await db.write(formData)
}
`

    const result = transformInlineServerActions(input, 'page')
    expect(result!.rewrittenExportNames).toEqual(['save'])
    expect(result!.code).toContain('export const save = $$ACTION_0_anonymous_server_function')
    expect(result!.code).toContain('async function $$ACTION_0_anonymous_server_function(formData)')
  })

  it('exports an exported function declaration under its own name', () => {
    const result = transformInlineServerActions(
      `export async function save(x) { 'use server'\n return x }\n`,
      'mod',
    )
    expect(result?.code).toContain('export const save = $$ACTION_0_save')
    expect(result?.rewrittenExportNames).toEqual(['save'])
  })
})
