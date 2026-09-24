const LINKS = [
  ['/about', 'About'],
  ['/nested', 'Nested'],
  ['/blog', 'Blog'],
  ['/products', 'Products'],
  ['/shop', 'Shop'],
  ['/actions', 'Actions'],
  ['/contact', 'Contact'],
  ['/pricing', 'Pricing'],
  ['/login', 'Login'],
  ['/signup', 'Signup'],
  ['/forgot', 'Forgot'],
] as const

export function SiteNav() {
  return (
    <nav class="bg-white border-b border-gray-200" data-testid="site-nav">
      <div class="max-w-7xl mx-auto px-6">
        <div class="flex items-center gap-6 h-16">
          <a href="/" class="text-xl font-bold text-gray-900 no-underline">
            Test App
          </a>
          {LINKS.map(([href, label]) => (
            <a href={href} class="text-sm text-gray-700 no-underline hover:text-gray-900">
              {label}
            </a>
          ))}
        </div>
      </div>
    </nav>
  )
}
