/* oxlint-disable typescript/prefer-readonly-parameter-types, typescript/no-unsafe-type-assertion -- MDX runtime shim: Solid component and prop types are mutable */
import type { EvaluateOptions as MdxEvaluateOptions } from '@mdx-js/mdx'
import type { Component, JSX } from 'solid-js'
import { evaluate as evaluateMdx } from '@mdx-js/mdx'
import { getMDXComponents } from 'rari/mdx/registry'
import { createComponent } from 'solid-js'
import { Dynamic } from 'solid-js/web'

export interface EvaluateOptions extends Omit<MdxEvaluateOptions, 'Fragment' | 'jsx' | 'jsxs'> {
  components?: Record<string, any>
}

export interface EvaluateResult {
  default: Component<{ components?: Record<string, any> }>
}

type JsxProps = Record<string, unknown>

// Solid has no element objects: MDX's runtime `jsx` calls build the reactive tree directly,
// with `Dynamic` picking the DOM (client) or ssrElement (server) path for string tags.
const solidJsxRuntime = {
  Fragment: (props: Readonly<{ children?: JSX.Element }>) => props.children,
  jsx: (type: unknown, props: JsxProps) =>
    createComponent(Dynamic, { ...props, component: type as string | Component<any> }),
  jsxs: (type: unknown, props: JsxProps) =>
    createComponent(Dynamic, { ...props, component: type as string | Component<any> }),
}

export async function evaluate(source: string, options: EvaluateOptions): Promise<EvaluateResult> {
  const { components: userComponents = {}, ...evaluateOptions } = options
  const compiled = await evaluateMdx(source, { ...evaluateOptions, ...solidJsxRuntime })
  const MDXContent = compiled.default
  const registryComponents = getMDXComponents(source)

  function RariMDXContent(props: Readonly<{ components?: { readonly [key: string]: any } }>) {
    const mergedComponents = {
      ...registryComponents,
      ...userComponents,
      ...props.components,
    }

    return createComponent(MDXContent as Component<any>, {
      ...props,
      components: mergedComponents,
    })
  }

  return {
    ...compiled,
    default: RariMDXContent,
  }
}
