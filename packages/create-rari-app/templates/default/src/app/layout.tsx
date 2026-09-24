import type { LayoutProps, Metadata } from 'rari'
import './globals.css'

export default function Layout(props: LayoutProps) {
  return (
    <html lang="en">
      <head />
      <body class="min-h-screen">
        <div class="min-h-screen">
          <nav class="bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm">
            <div class="max-w-7xl mx-auto px-6">
              <div class="flex items-center justify-between h-16">
                <div class="flex items-center gap-2">
                  <span class="text-2xl font-bold text-gray-900">{'{{PROJECT_NAME}}'}</span>
                </div>
                <ul class="flex gap-1 list-none m-0">
                  <li>
                    <a
                      href="/"
                      class="px-4 py-2 text-sm font-medium text-gray-700 no-underline hover:text-gray-900 hover:bg-gray-50 rounded-md transition-colors"
                    >
                      Home
                    </a>
                  </li>
                  <li>
                    <a
                      href="/about"
                      class="px-4 py-2 text-sm font-medium text-gray-700 no-underline hover:text-gray-900 hover:bg-gray-50 rounded-md transition-colors"
                    >
                      About
                    </a>
                  </li>
                </ul>
              </div>
            </div>
          </nav>
          <main class="max-w-7xl mx-auto px-6 py-8">{props.children}</main>
        </div>
      </body>
    </html>
  )
}

export const metadata: Metadata = {
  title: '{{PROJECT_NAME}}',
  description: 'A rari application',
}
