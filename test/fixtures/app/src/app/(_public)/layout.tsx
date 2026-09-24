import type { LayoutProps } from 'rari'

export default function PublicGroupLayout(props: LayoutProps) {
  return (
    <div>
      <div data-testid="public-group-banner">Public Group Banner</div>
      <div data-testid="public-group-children">{props.children}</div>
    </div>
  )
}
