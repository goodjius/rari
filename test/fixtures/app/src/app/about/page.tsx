import type { Metadata } from 'rari'

export default function AboutPage() {
  return (
    <div>
      <h1>About Page</h1>
      <p>This is the about page for testing navigation.</p>

      <div class="space-y-4 mt-8">
        {Array.from({ length: 50 }, (_, i) => (
          <p class="text-gray-600">This is paragraph {i + 1}.</p>
        ))}
      </div>

      <a href="/">Back to Home</a>
    </div>
  )
}

export const metadata: Metadata = {
  title: 'About',
  description: 'About page',
}
