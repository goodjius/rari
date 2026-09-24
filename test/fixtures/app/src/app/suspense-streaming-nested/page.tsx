import type { JSX } from 'solid-js'
import { createResource, Suspense } from 'solid-js'
import { isoTimestamp, sleep } from '../../utils/test-helpers'

function OuterComponent(props: { readonly delay: number; readonly children: JSX.Element }) {
  const [stamp] = createResource(async () => {
    await sleep(props.delay)
    return isoTimestamp()
  })

  return (
    <div data-testid="outer-content">
      <div>Outer content</div>
      <div data-testid="outer-timestamp">{stamp()}</div>
      {props.children}
    </div>
  )
}

function InnerComponent(props: { readonly delay: number; readonly name: string }) {
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

export default function NestedSuspensePage() {
  return (
    <div>
      <h1>Nested Suspense Test</h1>
      <Suspense fallback={<div data-testid="loading-outer">Loading outer...</div>}>
        <OuterComponent delay={500}>
          <Suspense fallback={<div data-testid="loading-inner">Loading inner...</div>}>
            <InnerComponent delay={2000} name="Inner" />
          </Suspense>
        </OuterComponent>
      </Suspense>
    </div>
  )
}
