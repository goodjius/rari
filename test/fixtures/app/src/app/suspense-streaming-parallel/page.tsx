import { createResource, Suspense } from 'solid-js'
import { isoTimestamp, sleep } from '../../utils/test-helpers'

function SlowComponent(props: { readonly name: string; readonly delay: number }) {
  const [stamp] = createResource(async () => {
    await sleep(props.delay)
    return isoTimestamp()
  })

  return (
    <div data-testid={`component-${props.name.toLowerCase()}`}>
      {props.name}:{stamp()}
    </div>
  )
}

export default function ParallelSuspensePage() {
  return (
    <div>
      <h1>Parallel Suspense Test</h1>
      <Suspense fallback={<div data-testid="loading-fast">Loading fast...</div>}>
        <SlowComponent name="Fast" delay={1000} />
      </Suspense>
      <Suspense fallback={<div data-testid="loading-slow">Loading slow...</div>}>
        <SlowComponent name="Slow" delay={2000} />
      </Suspense>
    </div>
  )
}
