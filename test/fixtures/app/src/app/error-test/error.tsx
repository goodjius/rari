export default function ErrorBoundary(props: {
  readonly error: unknown
  readonly reset: () => void
}) {
  return (
    <div data-testid="error-boundary">
      <h2>Something went wrong!</h2>
      <p data-testid="error-message">
        {props.error instanceof Error ? props.error.message : String(props.error)}
      </p>
      <a href="/error-test" data-testid="reset-link">
        Try again
      </a>
    </div>
  )
}
