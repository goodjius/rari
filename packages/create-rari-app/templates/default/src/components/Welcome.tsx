import Rari from './Rari'

export default function Welcome() {
  return (
    <div class="bg-white rounded-xl p-8 shadow-sm">
      <div class="flex items-center gap-4 mb-6">
        <Rari class="w-32 h-auto text-gray-900" />
      </div>
      <h2 class="text-2xl font-semibold mb-4 text-gray-900">
        🎉 Welcome to rari!
      </h2>
      <p class="text-gray-600 mb-4">
        You've successfully created a new rari application. This page is rendered on
        the server, with client islands where you need interactivity.
      </p>
      <div class="space-y-2 text-sm text-gray-500">
        <p>
          🚀
          <strong>High-performance</strong>
          {' '}
          SolidJS rendering
        </p>
        <p>
          ⚡
          <strong>Optimized</strong>
          {' '}
          Rust runtime
        </p>
        <p>
          🔥
          <strong>Hot module</strong>
          {' '}
          reloading
        </p>
        <p>
          📦
          <strong>Zero config</strong>
          {' '}
          setup
        </p>
      </div>
    </div>
  )
}
