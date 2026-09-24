import { decodeSeroval, encodeSeroval } from '../seroval-json'
import { applyRedirect, postAction, readActionRedirect } from './action-transport'
import { ActionDidNotRevalidate, parseActionRevalidationKind } from './revalidation-kind'

const SEROVAL_CONTENT_TYPE = 'application/x-rari-seroval'

function isEnvelope(value: unknown): value is { v: unknown } {
  return typeof value === 'object' && value !== null && 'v' in value
}

export async function callServerSolid(id: string, args: readonly unknown[]): Promise<unknown> {
  const response = await postAction(
    id,
    {
      'Accept': SEROVAL_CONTENT_TYPE,
      'Content-Type': 'text/plain;charset=UTF-8',
      'rsc-action-id': id,
    },
    encodeSeroval([...args]),
  )

  const redirect = readActionRedirect(response)
  if (redirect != null) {
    if (redirect !== '') applyRedirect(redirect)
    return { redirect }
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.startsWith(SEROVAL_CONTENT_TYPE)) {
    const message =
      response.status >= 400 && contentType.startsWith('text/plain')
        ? await response.text().catch(() => response.statusText)
        : `Server action "${id}" failed with status ${response.status}: ${response.statusText}`

    throw new Error(message)
  }

  const kind = parseActionRevalidationKind(response.headers.get('x-action-revalidated'))
  if (kind !== ActionDidNotRevalidate && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('rari:action-revalidated', { detail: { kind } }))
  }

  const envelope: unknown = decodeSeroval(await response.text())
  if (!isEnvelope(envelope)) throw new Error(`Server action "${id}" returned a malformed response`)
  return envelope.v
}

export function createServerReference(
  id: string,
): (...args: readonly unknown[]) => Promise<unknown> {
  return async (...args) => callServerSolid(id, args)
}
