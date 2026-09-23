import {
  createFromFetch,
  createTemporaryReferenceSet,
  encodeReply,
} from 'virtual:react-flight-client'
import { isRecord } from '@/shared/utils/type-guards'
import { serializeRouterState } from '../flight/serialize-router-state'
import { applyRedirect, postAction, readActionRedirect } from './action-transport'
import { scheduleActionFlightRefresh } from './flight-refresh'

interface ActionFlightResponse {
  a: unknown
  f?: unknown
}

function stripInternalActionMetadata(result: unknown): unknown {
  if (!isRecord(result)) return result

  const { '~rariSkipRefresh': _skipRefresh, ...rest } = result
  return rest
}

export async function callServer(id: string, args: readonly unknown[]): Promise<unknown> {
  const temporaryReferences = createTemporaryReferenceSet()
  const encoded = await encodeReply(args, { temporaryReferences })
  const headers: Record<string, string> = {
    'Accept': 'text/x-component',
    'rsc-action-id': id,
    'rari-router-state': serializeRouterState(),
  }

  let body: BodyInit
  if (typeof encoded === 'string') {
    headers['Content-Type'] = 'text/plain;charset=UTF-8'
    body = encoded
  } else {
    body = encoded
  }

  const response = await postAction(id, headers, body)

  const redirectLocation = readActionRedirect(response)
  if (redirectLocation != null) {
    if (redirectLocation !== '') applyRedirect(redirectLocation)

    return { redirect: redirectLocation }
  }

  const contentTypeHeader = response.headers.get('content-type')
  const contentType = contentTypeHeader != null && contentTypeHeader !== '' ? contentTypeHeader : ''
  const isFlightResponse = contentType.startsWith('text/x-component')

  if (!isFlightResponse) {
    const message =
      response.status >= 400 && contentType.startsWith('text/plain')
        ? await response.text().catch(() => response.statusText)
        : `Server action "${id}" failed with status ${response.status}: ${response.statusText}`

    throw new Error(message)
  }

  const flightResponse = await createFromFetch<ActionFlightResponse>(Promise.resolve(response), {
    callServer,
    temporaryReferences,
  })

  const actionResult: unknown = flightResponse.a
  const resolvedActionResult: unknown =
    actionResult instanceof Promise ? await actionResult : actionResult

  scheduleActionFlightRefresh(response, flightResponse, resolvedActionResult)

  return stripInternalActionMetadata(resolvedActionResult)
}
