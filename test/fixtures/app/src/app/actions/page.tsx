import { createResource, Show } from 'solid-js'
import { getTodos } from '@/components/todo/actions'
import TodoApp from '@/components/todo/TodoApp'

export default function ActionsPage() {
  const [todos] = createResource(getTodos)

  return (
    <div class="max-w-2xl mx-auto p-6">
      <h1 data-testid="page-title">Server Actions Test Page</h1>
      <p data-testid="page-description">Testing Solid server actions with Rari</p>
      <Show when={todos()}>{initial => <TodoApp initialTodos={initial()} />}</Show>
    </div>
  )
}
