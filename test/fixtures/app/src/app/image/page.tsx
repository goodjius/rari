import { Image } from 'rari/image'

export default function ImagePage() {
  return (
    <main id="image-page">
      <Image src="/photo.png" alt="A photo" width={640} height={480} />
    </main>
  )
}
