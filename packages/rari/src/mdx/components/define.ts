import type { Component } from 'solid-js'
import { isRecord } from '@/shared/utils/type-guards'
import { scanMdxComponentNames } from '../scan/names'

export interface MdxComponentEntry {
  readonly name: string
  readonly component: Component<any>
  readonly id: string
  readonly client?: boolean
  readonly exportName?: string
}

type MdxComponentsInput = Readonly<Record<string, Component<any> | MdxComponentEntry>>

function isResolvedEntry(value: unknown): value is MdxComponentEntry {
  return isRecord(value) && typeof value.id === 'string' && 'component' in value
}

/* oxlint-disable typescript/prefer-readonly-parameter-types Solid's Component type expands to a mutable function signature */
function isEntryArray(
  input: readonly MdxComponentEntry[] | MdxComponentsInput,
): input is readonly MdxComponentEntry[] {
  return Array.isArray(input)
}

function normalizeRegistry(
  input: readonly MdxComponentEntry[] | MdxComponentsInput,
): MdxComponentEntry[] {
  if (isEntryArray(input)) return [...input]

  return Object.entries(input).map(([name, value]) => {
    if (isResolvedEntry(value)) {
      return {
        component: value.component,
        id: value.id,
        exportName: value.exportName,
        name,
        client: value.client ?? true,
      }
    }

    throw new Error(
      `[rari/mdx] Component "${name}" is missing module metadata. ` +
        'Pass components to defineMdxComponents({ ... }) in a file processed by the rari vite plugin.',
    )
  })
}

/* oxlint-enable typescript/prefer-readonly-parameter-types */

export function defineMdxComponents(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types
  input: readonly MdxComponentEntry[] | MdxComponentsInput,
): (content: string) => Record<string, any> {
  const registry = normalizeRegistry(input)

  return (content: string) => {
    const result: Record<string, any> = {}
    const usedComponentNames = new Set(scanMdxComponentNames(content))

    // Client components arrive already wrapped as islands by the rari vite plugin.
    for (const entry of registry) {
      if (usedComponentNames.has(entry.name)) result[entry.name] = entry.component
    }

    return result
  }
}
