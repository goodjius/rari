// Shared by the client entry (hydrates islands) and the client router (tears them down and
// waits for the next page's islands); kept separate so the two don't import each other.
const islandDisposers: Array<() => void> = []
const pendingHydrations = new Set<Promise<void>>()

export function registerIslandDisposer(dispose: () => void): void {
  islandDisposers.push(dispose)
}

// oxlint-disable-next-line typescript/promise-function-async -- returns the same Promise stored in pendingHydrations
export function trackHydrationPromise(start: () => Promise<void>): Promise<void> {
  const promise: Promise<void> = start()
    .catch((error: unknown) => {
      console.error('[rari] island hydration failed:', error)
    })
    .finally(() => {
      pendingHydrations.delete(promise)
    })
  pendingHydrations.add(promise)
  return promise
}

/** Resolves once every island hydration started so far has finished (or failed). */
export async function settleSolidIslands(): Promise<void> {
  await Promise.allSettled(pendingHydrations)
}

/** Tears down every hydrated island (used by the client router before swapping the page). */
export function disposeSolidIslands(): void {
  for (const dispose of islandDisposers.splice(0)) dispose()
}
