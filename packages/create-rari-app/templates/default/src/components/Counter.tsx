'use client'

import { createSignal } from 'solid-js'

// A client island: rendered on the server, then hydrated in the browser.
export default function Counter() {
  const [count, setCount] = createSignal(0)

  return (
    <div class="bg-white rounded-xl p-8 shadow-sm border border-gray-200">
      <h2 class="text-2xl font-semibold mb-4 text-gray-900">🧩 Client Island</h2>
      <p class="text-gray-600 mb-4">This component hydrates in the browser, so it can hold state.</p>
      <button
        type="button"
        class="px-4 py-2 rounded-md bg-gray-900 text-white hover:bg-gray-700"
        onClick={() => setCount(count() + 1)}
      >
        Clicked {count()} times
      </button>
    </div>
  )
}
