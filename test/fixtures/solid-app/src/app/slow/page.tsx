import { createResource } from 'solid-js'

async function load(): Promise<string> {
  await new Promise<void>(resolve => {
    setTimeout(resolve, 20)
  })
  return 'slow-value'
}

export default function SlowPage() {
  const [data] = createResource(load)
  return <p id="slow-page">{data()}</p>
}
