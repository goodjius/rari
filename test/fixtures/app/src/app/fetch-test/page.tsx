import process from 'node:process'
import { createResource } from 'solid-js'

const ECHO_URL = `http://localhost:${process.env.PORT != null && process.env.PORT !== '' ? process.env.PORT : 3000}/test-fetch.json`

interface EchoPayload {
  readonly ok: boolean
  readonly message: string
  readonly counter: number
}

async function loadEcho(): Promise<EchoPayload> {
  const res = await fetch(ECHO_URL, {
    next: { revalidate: 60, tags: ['echo'] },
  } as RequestInit & { next?: { revalidate?: number; tags?: string[] } })
  return (await res.json()) as EchoPayload
}

export default function FetchTestPage() {
  const [data] = createResource(loadEcho)

  return (
    <div>
      <h1>Fetch Cache Test</h1>
      <p data-testid="echo-ok">{data()?.ok === true ? 'true' : 'false'}</p>
      <p data-testid="echo-message">{data()?.message}</p>
      <p data-testid="echo-counter">counter={data()?.counter}</p>
    </div>
  )
}
