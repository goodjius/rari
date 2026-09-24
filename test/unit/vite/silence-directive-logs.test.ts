import {
  createSilenceDirectiveLogsPlugin,
  isDirectiveLog,
} from '@rari/vite/build/silence-directive-logs'
import { describe, expect, it } from 'vite-plus/test'

describe('silence-directive-logs', () => {
  it('detects use client and use server MODULE_LEVEL_DIRECTIVE logs', () => {
    expect(
      isDirectiveLog({
        code: 'MODULE_LEVEL_DIRECTIVE',
        message: 'The semantics of the module level directive "use client" may not be preserved',
      }),
    ).toBe(true)
    expect(
      isDirectiveLog({
        code: 'MODULE_LEVEL_DIRECTIVE',
        message: 'The semantics of the module level directive "use server" may not be preserved',
      }),
    ).toBe(true)
    expect(
      isDirectiveLog({
        code: 'CIRCULAR_DEPENDENCY',
        message: 'Circular dependency',
      }),
    ).toBe(false)
  })

  it('filters directive warnings from the plugin onLog hook', () => {
    const plugin = createSilenceDirectiveLogsPlugin()

    expect(
      plugin.onLog('warn', {
        code: 'MODULE_LEVEL_DIRECTIVE',
        message: 'directive "use client" may not be preserved',
      }),
    ).toBe(false)

    expect(plugin.onLog('warn', { code: 'CIRCULAR_DEPENDENCY', message: 'cycle' })).toBeUndefined()
  })
})
