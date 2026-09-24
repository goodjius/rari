import type { Metadata } from 'rari'
import { headers } from 'rari/headers'
import { createResource } from 'solid-js'

async function loadHeaders() {
  const requestHeaders = await headers()
  return {
    userAgent: requestHeaders.get('user-agent'),
    host: requestHeaders.get('host'),
    hasAccept: requestHeaders.has('accept'),
  }
}

export default function HeadersTestPage() {
  const [data] = createResource(loadHeaders)

  return (
    <div>
      <h1>headers() Test</h1>
      <p data-testid="user-agent">{data()?.userAgent ?? 'missing'}</p>
      <p data-testid="host">{data()?.host ?? 'missing'}</p>
      <p data-testid="has-accept">{data()?.hasAccept === true ? 'yes' : 'no'}</p>
    </div>
  )
}

export const metadata: Metadata = {
  title: 'headers() Test',
}
