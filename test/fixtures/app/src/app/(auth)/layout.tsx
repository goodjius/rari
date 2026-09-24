import type { LayoutProps } from 'rari'

export default function AuthGroupLayout(props: LayoutProps) {
  return (
    <div>
      <div data-testid="auth-group-banner">Auth Group Banner</div>
      <div data-testid="auth-group-children">{props.children}</div>
    </div>
  )
}
