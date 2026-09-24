import process from 'node:process'

export function getRariLogPath(): string {
  return (
    process.env.RARI_LOG_FILE ??
    `${process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? '/tmp'}/rari-web.log`
  )
}
