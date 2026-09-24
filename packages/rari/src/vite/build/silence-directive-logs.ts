type DirectiveLog = Readonly<{
  code?: string
  message?: string
}>

export function isDirectiveLog(log: DirectiveLog): boolean {
  return (
    log.code === 'MODULE_LEVEL_DIRECTIVE' &&
    (log.message?.includes('use client') === true || log.message?.includes('use server') === true)
  )
}

/** Bundlers warn that 'use client'/'use server' semantics may not be preserved; rari's transforms own them. */
export function createSilenceDirectiveLogsPlugin(): {
  name: string
  onLog: (_level: string, log: DirectiveLog) => false | undefined
} {
  return {
    name: 'rari:silence-directive-logs',
    onLog(_level, log) {
      return isDirectiveLog(log) ? false : undefined
    },
  }
}
