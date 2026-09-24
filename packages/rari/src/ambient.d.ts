/// <reference types="vite-plus/client" />

interface ImportMetaEnv {
  readonly RARI_SERVER_URL?: string
  readonly VITE_RSC_PORT?: string
}

declare global {
  interface RequestInit {
    rari?: {
      revalidate?: number | false
      tags?: string[]
      timeout?: number
    }
  }

  interface GlobalThis {
    '~rariExecuteProxy'?: (
      request: Readonly<{
        readonly url: string
        readonly method: string
        readonly headers: { readonly [key: string]: string }
      }>,
    ) => Promise<{
      continue: boolean
      redirect?: {
        destination: string
        permanent: boolean
      }
      rewrite?: string
      requestHeaders?: Record<string, string | string[]>
      responseHeaders?: Record<string, string | string[]>
      response?: {
        status: number
        headers: Record<string, string | string[]>
        body?: string
      }
    }>
  }
}
