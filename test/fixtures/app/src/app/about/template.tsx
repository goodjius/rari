import type { JSX } from 'solid-js'

export default function AboutTemplate(props: { readonly children: JSX.Element }) {
  return <div data-testid="about-template">{props.children}</div>
}
