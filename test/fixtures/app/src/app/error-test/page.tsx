import type { PageProps } from 'rari'

export default function ErrorTestPage(props: PageProps) {
  const flag = props.searchParams.throw
  if (flag === '1' || (Array.isArray(flag) && flag[0] === '1'))
    throw new Error('Test error from component')

  return (
    <div data-testid="error-test-page">
      <h1>Error Test Page</h1>
      <p>This page throws while rendering when requested with ?throw=1.</p>
      <a href="/error-test?throw=1" data-testid="trigger-error-link">
        Trigger Error
      </a>
    </div>
  )
}
