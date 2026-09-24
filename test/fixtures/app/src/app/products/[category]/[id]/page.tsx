import type { Metadata, PageProps } from 'rari'

export default function ProductPage(props: PageProps) {
  const category = String(props.params.category)
  const id = String(props.params.id)

  return (
    <div>
      <h1>Product {id}</h1>
      <p>Category: {category}</p>
      <div data-testid="category-value">{category}</div>
      <div data-testid="id-value">{id}</div>
      <a href="/products">Back to Products</a>
    </div>
  )
}

export function generateMetadata({ params }: PageProps): Metadata {
  const { category, id } = params

  return {
    title: `${String(category)} - Product ${String(id)}`,
    description: `Product ${String(id)} in ${String(category)} category`,
  }
}
