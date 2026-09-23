'use client'

import { createSignal } from 'solid-js'

export default function Counter(props: Readonly<{ label?: string }>) {
  const [count, setCount] = createSignal(0)
  return (
    <button
      id="counter"
      onClick={() => {
        setCount(count() + 1)
      }}
    >
      {props.label ?? 'count'}: {count()}
    </button>
  )
}
