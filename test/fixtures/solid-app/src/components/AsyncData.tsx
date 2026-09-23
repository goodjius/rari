import { createResource, Suspense } from 'solid-js'

async function delayed(): Promise<string> {
  await new Promise<void>(resolve => {
    setTimeout(resolve, 20)
  })
  return 'resolved-value'
}

function Value() {
  const [data] = createResource(delayed)
  return <span id="async-value">{data()}</span>
}

export default function AsyncData() {
  return (
    <Suspense fallback={<span id="async-fallback">Loading...</span>}>
      <Value />
    </Suspense>
  )
}
