import { createResource, Suspense } from 'solid-js'

async function loadTimestamp() {
  // This runs on the server!
  await new Promise(resolve => setTimeout(resolve, 100))
  return new Date().toISOString()
}

// A server component: it renders on the server and ships no JavaScript to the browser.
export default function ServerTime() {
  const [timestamp] = createResource(loadTimestamp)

  return (
    <div class="bg-gradient-to-r from-green-50 to-blue-50 rounded-xl p-8 shadow-sm border border-green-200">
      <h2 class="text-2xl font-semibold mb-4 text-gray-900">⚡ Server Component</h2>
      <p class="text-gray-600 mb-4">
        This component renders on the server with rari's high-performance Rust runtime.
      </p>
      <div class="bg-white rounded-lg p-4 border">
        <p class="text-sm text-gray-500 mb-1">Server timestamp:</p>
        <Suspense fallback={<p class="font-mono text-lg text-gray-900">…</p>}>
          <p class="font-mono text-lg text-gray-900">{timestamp()}</p>
        </Suspense>
      </div>
      <p class="text-xs text-gray-500 mt-4">
        💡 This timestamp was generated on the server and won't change on refresh.
      </p>
    </div>
  )
}
