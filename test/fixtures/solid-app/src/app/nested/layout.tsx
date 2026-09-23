import type { JSX } from 'solid-js'

interface NestedLayoutProps {
  readonly children: JSX.Element
  readonly pathname: string
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- JSX.Element is a mutable DOM node type
export default function NestedLayout(props: NestedLayoutProps): JSX.Element {
  return (
    <section id="nested-layout" data-pathname={props.pathname}>
      {props.children}
    </section>
  )
}
