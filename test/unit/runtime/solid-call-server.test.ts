import { callServerSolid, createServerReference } from '@rari/runtime/actions/solid-call-server'
import { deserialize, serialize } from 'seroval'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

function seroval(value: unknown, init: ResponseInit = {}): Response {
  return new Response(serialize({ v: value }), {
    status: 200,
    headers: { 'content-type': 'application/x-rari-seroval' },
    ...init,
  })
}

describe('callServerSolid', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('window', {
      location: { pathname: '/actions', search: '?a=1', href: 'http://localhost/actions?a=1' },
      dispatchEvent: vi.fn(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('posts seroval-encoded args with the action id and decodes the envelope', async () => {
    fetchMock.mockResolvedValueOnce(seroval({ when: new Date(0) }))

    const result = await callServerSolid('mod#greet', ['World', 2])

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/actions?a=1')
    expect(init?.headers).toMatchObject({ 'rsc-action-id': 'mod#greet' })
    expect(deserialize(typeof init?.body === 'string' ? init.body : '')).toEqual(['World', 2])
    expect(result).toEqual({ when: new Date(0) })
  })

  it('returns undefined results unambiguously', async () => {
    fetchMock.mockResolvedValueOnce(seroval(undefined))
    expect(await callServerSolid('mod#noop', [])).toBeUndefined()
  })

  it('surfaces text/plain server errors as Error', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('nope', { status: 400, headers: { 'content-type': 'text/plain' } }),
    )
    await expect(callServerSolid('mod#x', [])).rejects.toThrow('nope')
  })

  it('reports a status error for unexpected content types', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<html>', { status: 500, headers: { 'content-type': 'text/html' } }),
    )
    await expect(callServerSolid('mod#x', [])).rejects.toThrow(/failed with status 500/)
  })

  it('follows redirect headers to safe targets only', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 200, headers: { 'x-action-redirect': '/done;push' } }),
    )
    const result = await callServerSolid('mod#x', [])
    expect(result).toEqual({ redirect: '/done' })
    expect(window.location.href).toBe('http://localhost/done')

    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: { 'x-action-redirect': 'javascript:alert(1);push' },
      }),
    )
    await callServerSolid('mod#x', [])
    expect(window.location.href).toBe('http://localhost/done')
  })

  it('times out', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('t', 'TimeoutError'))
    await expect(callServerSolid('mod#slow', [])).rejects.toThrow(/timed out/)
  })

  it('createServerReference binds the id', async () => {
    fetchMock.mockResolvedValueOnce(seroval(7))
    expect(await createServerReference('mod#n')(1)).toBe(7)
  })
})
