import type { JSX } from 'solid-js'

interface ErrorProps {
  readonly error: unknown
  readonly reset: () => void
}

export default function ErrorPage(props: ErrorProps): JSX.Element {
  return (
    <p id="route-error">
      Something went wrong:{' '}
      {props.error instanceof Error ? props.error.message : String(props.error)}
    </p>
  )
}
