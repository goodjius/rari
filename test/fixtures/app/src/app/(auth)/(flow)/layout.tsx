import type { LayoutProps } from 'rari'

export default function FlowGroupLayout(props: LayoutProps) {
  return (
    <div>
      <div data-testid="flow-group-banner">Flow Group Banner</div>
      <div data-testid="flow-group-children">{props.children}</div>
    </div>
  )
}
