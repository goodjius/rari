import type { Metadata } from 'rari'

export default function AboutPage() {
  return (
    <div class="space-y-6">
      <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
        <h1 class="text-4xl font-bold text-gray-900 mb-4">About</h1>
        <p class="text-lg text-gray-600 mb-4">
          This is a rari application using the app router.
        </p>
        <p class="text-gray-600">
          rari is a performance-first SolidJS framework powered by Rust, featuring:
        </p>
        <ul class="list-disc list-inside text-gray-600 mt-4 space-y-2">
          <li>Streaming server rendering with islands</li>
          <li>File-based routing</li>
          <li>Server Actions</li>
          <li>Zero-config setup</li>
          <li>Fast development experience</li>
        </ul>
      </div>
    </div>
  )
}

export const metadata: Metadata = {
  title: 'About | {{PROJECT_NAME}}',
  description: 'Learn more about this rari application',
}
