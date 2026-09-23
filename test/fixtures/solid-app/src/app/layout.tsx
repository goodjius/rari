import type { JSX } from 'solid-js'

interface LayoutProps {
  readonly children: JSX.Element
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- JSX.Element is a mutable DOM node type
export default function Layout(props: LayoutProps) {
  return (
    <html lang="en">
      <head />
      <body>
        <main>{props.children}</main>
      </body>
    </html>
  )
}
