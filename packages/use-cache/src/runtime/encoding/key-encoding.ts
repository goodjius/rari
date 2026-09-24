import { deterministicStringify } from '../utils/deterministic-stringify'

// Object key insertion order is part of the cache key.
export function encodeCacheKeyParts(parts: readonly unknown[]): string {
  return deterministicStringify(parts, new WeakSet(), new WeakSet(), true)
}
