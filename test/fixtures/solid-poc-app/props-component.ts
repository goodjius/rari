// Props fixture for the Solid migration's props/wire-protocol phase. Echoes
// a prop into its output so a test can assert real props actually reach the
// component (not just that rendering doesn't crash). See component.ts for
// why ssrElement is used instead of solid-js/h or JSX.

import { ssrElement } from 'solid-js/web'

interface PropsEchoProps {
  readonly count?: number
}

export default function PropsEcho(props: PropsEchoProps): unknown {
  return ssrElement('div', { id: 'props-echo' }, `count=${props.count}`, false)
}
