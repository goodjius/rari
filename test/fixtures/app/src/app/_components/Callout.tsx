import type { JSX } from 'solid-js'

export function Callout(props: { readonly children: JSX.Element }) {
  return (
    <aside data-testid="private-callout" class="callout">
      {props.children}
    </aside>
  )
}
