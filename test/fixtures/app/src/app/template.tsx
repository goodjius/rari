import type { JSX } from 'solid-js'

export default function RootTemplate(props: { readonly children: JSX.Element }) {
  return (
    <div data-testid="root-template">
      <div data-testid="root-template-children">{props.children}</div>
    </div>
  )
}
