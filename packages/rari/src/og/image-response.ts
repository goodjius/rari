import type { JSX } from 'solid-js'
import { renderToString } from 'solid-js/web'

export interface ImageResponseOptions {
  readonly width?: number
  readonly height?: number
}

export interface ImageResponseSize {
  readonly width: number
  readonly height: number
}

interface SerializedTextElement {
  type: 'text'
  value: string
}

interface SerializedTreeElement {
  type: 'element'
  elementType: string
  props: Record<string, unknown>
  children: SerializedElement[]
}

type SerializedElement = SerializedTextElement | SerializedTreeElement

const VOID_ELEMENTS = new Set(['img', 'br', 'hr', 'input', 'meta', 'link'])
const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
}
const ENTITY_RE = /&(?:amp|lt|gt|quot|#39|#x27);/g
const TAG_RE =
  /<!--[\s\S]*?-->|<\/([a-z][\w:-]*)\s*>|<([a-z][\w:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/gi
const ATTR_RE = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g

function decode(text: string): string {
  return text.replace(ENTITY_RE, match => ENTITIES[match] ?? match)
}

function camelCase(name: string): string {
  return name.startsWith('--')
    ? name
    : name.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase())
}

// `;` and `:` inside url(...)/quotes (data URLs, font names) must not split declarations.
function parseStyle(css: string): Record<string, string> {
  const style: Record<string, string> = {}
  let depth = 0
  let quote = ''
  let start = 0
  const flush = (end: number) => {
    const decl = css.slice(start, end)
    const colon = decl.indexOf(':')
    if (colon > 0) {
      const key = decl.slice(0, colon).trim()
      const value = decl.slice(colon + 1).trim()
      if (key !== '' && value !== '') style[camelCase(key)] = value
    }
    start = end + 1
  }
  for (let i = 0; i < css.length; i++) {
    const ch = css[i]
    if (quote !== '') {
      if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    else if (ch === ';' && depth === 0) flush(i)
  }
  flush(css.length)
  return style
}

function parseAttributes(raw: string): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  for (const match of raw.matchAll(ATTR_RE)) {
    const name = match.at(1) ?? ''
    const [dq, sq, bare] = [match.at(2), match.at(3), match.at(4)]
    if (name.startsWith('data-hk')) continue
    const value = decode(dq ?? sq ?? bare ?? '')
    props[name] = name === 'style' ? parseStyle(value) : value
  }
  return props
}

/** Parses Solid's SSR output (well-formed, no raw-text elements) into the tree the Rust OG generator consumes. */
function parseHtml(html: string): SerializedTreeElement[] {
  const root: SerializedTreeElement = {
    type: 'element',
    elementType: 'div',
    props: {},
    children: [],
  }
  const stack: SerializedTreeElement[] = [root]
  let cursor = 0

  const pushText = (raw: string) => {
    const text = decode(raw)
    if (text.trim() !== '') stack.at(-1)?.children.push({ type: 'text', value: text })
  }

  for (const match of html.matchAll(TAG_RE)) {
    pushText(html.slice(cursor, match.index))
    cursor = match.index + match[0].length

    const [closing, opening, rawAttrs, selfClose] = [
      match.at(1),
      match.at(2),
      match.at(3),
      match.at(4),
    ]
    if (opening != null) {
      const tag = opening.toLowerCase()
      const node: SerializedTreeElement = {
        type: 'element',
        elementType: tag,
        props: parseAttributes(rawAttrs ?? ''),
        children: [],
      }
      stack.at(-1)?.children.push(node)
      if (selfClose !== '/' && !VOID_ELEMENTS.has(tag)) stack.push(node)
    } else if (closing != null && stack.length > 1) {
      stack.pop()
    }
  }
  pushText(html.slice(cursor))

  return root.children.filter((child): child is SerializedTreeElement => child.type === 'element')
}

export class ImageResponse {
  private readonly element: JSX.Element | (() => JSX.Element)
  private readonly options: ImageResponseOptions

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- JSX.Element is a mutable DOM node type
  constructor(element: JSX.Element | (() => JSX.Element), options: ImageResponseOptions = {}) {
    this.element = element
    this.options = {
      width: options.width != null && options.width !== 0 ? options.width : 1200,
      height: options.height != null && options.height !== 0 ? options.height : 630,
    }
  }

  toJSON() {
    const render = typeof this.element === 'function' ? this.element : () => this.element
    const root = parseHtml(renderToString(render)).at(0)
    return { type: 'ImageResponse', element: root ?? null, options: this.options }
  }
}
