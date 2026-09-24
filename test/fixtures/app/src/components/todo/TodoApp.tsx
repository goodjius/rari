/* oxlint-disable typescript/prefer-readonly-parameter-types -- Solid props */
'use client'

import type { Todo, TodoActionState } from './actions'
import { createSignal, For, Show } from 'solid-js'
import { addTodo, clearCompleted, deleteTodo, resetTodos, toggleTodo } from './actions'

interface TodoAppProps {
  readonly initialTodos: readonly Todo[]
}

export default function TodoApp(props: TodoAppProps) {
  // oxlint-disable-next-line solid/reactivity -- initial value only; the list is owned locally afterwards
  const [todos, setTodos] = createSignal<readonly Todo[]>(props.initialTodos)
  const [error, setError] = createSignal<string | null>(null)
  const [added, setAdded] = createSignal(false)
  const [pending, setPending] = createSignal(false)

  async function run(action: () => Promise<TodoActionState>, markAdded = false) {
    setPending(true)
    try {
      const result = await action()
      if (result.success && result.todos) {
        setTodos(result.todos)
        setError(null)
        setAdded(markAdded)
      } else {
        setError(result.error ?? 'Action failed')
        setAdded(false)
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <div data-testid="todo-form">
        <h2>Add Todo</h2>
        <form
          onSubmit={event => {
            event.preventDefault()
            const form = event.currentTarget
            // Read before run(): it disables the input, and disabled inputs are omitted from FormData.
            const text = String(new FormData(form).get('text') ?? '')
            void run(async () => addTodo(text), true).then(() => {
              if (!error()) form.reset()
            })
          }}
        >
          <input
            type="text"
            name="text"
            data-testid="todo-input"
            placeholder="Enter todo text"
            disabled={pending()}
          />
          <button type="submit" data-testid="submit-button" disabled={pending()}>
            {pending() ? 'Adding...' : 'Add Todo'}
          </button>
        </form>
        <Show when={error()}>
          <div data-testid="error-message">{error()}</div>
        </Show>
        <Show when={added()}>
          <div data-testid="success-message">Todo added successfully!</div>
        </Show>
        <div data-testid="pending-state">{pending() ? 'pending' : 'idle'}</div>
      </div>

      <div data-testid="todo-list">
        <h2>Todo List</h2>
        <div data-testid="todo-count">Total: {todos().length}</div>
        <ul>
          <For each={todos()}>
            {todo => (
              <li data-testid={`todo-item-${todo.id}`}>
                <span data-testid={`todo-text-${todo.id}`}>{todo.text}</span>
                <span data-testid={`todo-status-${todo.id}`}>
                  {todo.completed ? 'completed' : 'active'}
                </span>
                <button
                  type="button"
                  data-testid={`toggle-button-${todo.id}`}
                  disabled={pending()}
                  onClick={() => void run(async () => toggleTodo(todo.id))}
                >
                  Toggle
                </button>
                <button
                  type="button"
                  data-testid={`delete-button-${todo.id}`}
                  disabled={pending()}
                  onClick={() => void run(async () => deleteTodo(todo.id))}
                >
                  Delete
                </button>
              </li>
            )}
          </For>
        </ul>
        <button
          type="button"
          data-testid="clear-completed-button"
          disabled={pending()}
          onClick={() => void run(async () => clearCompleted())}
        >
          Clear Completed
        </button>
        <button
          type="button"
          data-testid="reset-button"
          disabled={pending()}
          onClick={() => void run(async () => resetTodos())}
        >
          Reset Todos
        </button>
      </div>
    </>
  )
}
