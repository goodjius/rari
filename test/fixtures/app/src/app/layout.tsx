import type { LayoutProps, Metadata } from 'rari'
import { SiteNav } from './site-nav'
import './globals.css'

export default function Layout(props: LayoutProps) {
  return (
    <html lang="en">
      <head />
      <body class="min-h-screen bg-gray-50">
        <div class="min-h-screen bg-gray-50">
          <SiteNav />
          <main class="max-w-7xl mx-auto px-6 py-8">{props.children}</main>
        </div>
      </body>
    </html>
  )
}

export const metadata: Metadata = {
  title: 'Test App',
  description: 'rari test fixture app',
}
