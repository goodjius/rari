import { createResource, Show, Suspense } from 'solid-js'
import { sleep } from '../../utils/test-helpers'

// Errors thrown after the shell has flushed cannot reach an <ErrorBoundary>: Solid surfaces them
// through client hydration of the boundary, and only islands hydrate. Handle them where they occur.
function ThrowingComponent(props: { readonly delay: number }) {
  const [result] = createResource(async () => {
    try {
      await sleep(props.delay)
      throw new Error('Simulated component error')
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  })

  return (
    <Show when={result()?.error}>
      {message => (
        <div class="rari-error" data-testid="suspense-error">
          Error loading content: {message()}
        </div>
      )}
    </Show>
  )
}

export default function ErrorSuspensePage() {
  return (
    <div>
      <h1>Suspense Error Recovery Test</h1>
      <Suspense fallback={<div data-testid="loading">Loading...</div>}>
        <ThrowingComponent delay={800} />
      </Suspense>
    </div>
  )
}
