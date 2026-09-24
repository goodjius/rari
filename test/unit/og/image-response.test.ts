import type { JSX } from 'solid-js'
import { ssrElement } from 'solid-js/web'
import { describe, expect, it } from 'vite-plus/test'
import { ImageResponse } from '../../../packages/rari/src/og/image-response'

// `ssrElement` is what Solid's `generate: 'ssr'` compiler emits for dynamic elements. Its `{ t }`
// result is typed loosely, so it is asserted to JSX.Element like compiled JSX would be.
function el(
  tag: string,
  props: Readonly<Record<string, unknown>>,
  children?: unknown,
): JSX.Element {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return ssrElement(tag, props, children, false) as unknown as JSX.Element
}

describe('image response', () => {
  it('serializes SSR output into the element tree with camelCased style props', () => {
    const response = new ImageResponse(
      el(
        'div',
        { style: { 'display': 'flex', 'flex-direction': 'column', 'background': '#0d1117' } },
        el('div', { style: { 'font-size': '48px', 'color': '#f0f6fc' } }, 'Hello'),
      ),
    )

    expect(response.toJSON()).toMatchObject({
      type: 'ImageResponse',
      options: { width: 1200, height: 630 },
      element: {
        type: 'element',
        elementType: 'div',
        props: { style: { display: 'flex', flexDirection: 'column', background: '#0d1117' } },
        children: [
          {
            type: 'element',
            elementType: 'div',
            props: { style: { fontSize: '48px', color: '#f0f6fc' } },
            children: [{ type: 'text', value: 'Hello' }],
          },
        ],
      },
    })
  })

  it('does not split style declarations on semicolons inside url() values', () => {
    const image = 'url(data:image/png;base64,AAAA)'
    const response = new ImageResponse(
      el('div', { style: { 'background-image': image, 'color': 'red' } }),
    )

    expect(response.toJSON().element?.props).toMatchObject({
      style: { backgroundImage: image, color: 'red' },
    })
  })

  it('decodes entities, treats void elements as leaves and drops hydration attributes', () => {
    const response = new ImageResponse(
      () =>
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        ({
          t: '<div data-hk="0-0"><img src="/a.png?x=1&amp;y=2"/><p>a &lt; b</p></div>',
        }) as unknown as JSX.Element,
    )

    expect(response.toJSON().element).toMatchObject({
      elementType: 'div',
      props: {},
      children: [
        { elementType: 'img', props: { src: '/a.png?x=1&y=2' }, children: [] },
        { elementType: 'p', children: [{ type: 'text', value: 'a < b' }] },
      ],
    })
  })

  it('honours explicit dimensions', () => {
    const response = new ImageResponse(el('div', {}), { width: 800, height: 400 })
    expect(response.toJSON().options).toEqual({ width: 800, height: 400 })
  })
})
