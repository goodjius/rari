import type { Metadata } from 'rari'

export default function HomePage() {
  return (
    <div class="max-w-2xl mx-auto">
      <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
        <h1 class="text-3xl font-bold text-gray-900 mb-4">Test App Home</h1>
        <p class="text-gray-600 mb-6">This is the test fixture app for rari e2e tests.</p>
        <nav class="space-y-2">
          <a href="/about" class="block text-blue-600 hover:underline">
            About Page
          </a>
          <a href="/nested" class="block text-blue-600 hover:underline">
            Nested Routes
          </a>
          <a href="/contact" class="block text-blue-600 hover:underline">
            Contact (in (_public) group)
          </a>
          <a href="/login" class="block text-blue-600 hover:underline">
            Login (in (auth) group)
          </a>
        </nav>
      </div>
    </div>
  )
}

export const metadata: Metadata = {
  title: 'Home',
  description: 'Test app home',
}
