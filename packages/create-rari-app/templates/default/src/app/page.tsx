import type { Metadata } from 'rari'
import Counter from '@/components/Counter'
import ServerTime from '@/components/ServerTime'
import Welcome from '@/components/Welcome'

export default function HomePage() {
  return (
    <div class="space-y-8">
      <Welcome />
      <ServerTime />
      <Counter />
    </div>
  )
}

export const metadata: Metadata = {
  title: 'Home | {{PROJECT_NAME}}',
  description: 'Welcome to your new rari application',
}
