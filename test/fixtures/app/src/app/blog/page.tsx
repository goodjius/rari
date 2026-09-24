import type { Metadata } from 'rari'

export default function BlogPage() {
  return (
    <div>
      <h1>Blog</h1>
      <p>Welcome to the blog.</p>
      <nav class="space-y-2 mt-4">
        <a href="/blog/hello-world" class="block text-blue-600 hover:underline">
          Hello World Post
        </a>
        <a href="/blog/typescript-tips" class="block text-blue-600 hover:underline">
          TypeScript Tips Post
        </a>
      </nav>
    </div>
  )
}

export const metadata: Metadata = {
  title: 'Blog',
  description: 'Blog posts',
}
