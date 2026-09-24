import type { PageProps } from 'rari'
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

export default function SuspenseStreamingPage(props: PageProps) {
  const rawRun: unknown = props.searchParams.run
  const runId =
    typeof rawRun === 'string'
      ? rawRun
      : Array.isArray(rawRun) && typeof rawRun[0] === 'string'
        ? rawRun[0]
        : undefined

  return (
    <div>
      <h1>Suspense Streaming Test</h1>
      {runId != null && runId !== '' ? <div data-testid="run-id">{runId}</div> : null}
      <Suspense fallback={<div data-testid="loading-a">Loading A...</div>}>
        <SlowComponent name="A" delay={1000} />
      </Suspense>
      <Suspense fallback={<div data-testid="loading-b">Loading B...</div>}>
        <SlowComponent name="B" delay={2000} />
      </Suspense>
      <Suspense fallback={<div data-testid="loading-c">Loading C...</div>}>
        <SlowComponent name="C" delay={3000} />
      </Suspense>
    </div>
  )
}
