'use client'

import type { JSX } from 'solid-js'
import type { ImageFormat } from './constants'
import { createEffect, createMemo, createSignal, onCleanup, Show } from 'solid-js'
import { DEFAULT_DEVICE_SIZES, DEFAULT_FORMATS } from './constants'
import { resolveOptimizedSizePlan } from './size-plan'
import { buildImageUrl } from './url'

export interface StaticImageData {
  readonly src: string
  readonly height: number
  readonly width: number
  readonly blurDataURL?: string
}

export interface ImageProps {
  readonly src: string | StaticImageData
  readonly alt: string
  readonly width?: number
  readonly height?: number
  readonly quality?: number
  readonly preload?: boolean
  readonly loading?: 'lazy' | 'eager'
  readonly placeholder?: 'blur' | 'empty'
  readonly blurDataURL?: string
  readonly fill?: boolean
  readonly sizes?: string
  readonly style?: JSX.CSSProperties
  readonly class?: string
  readonly onLoad?: (event: Event) => void
  readonly onError?: (event: Event) => void
  readonly unoptimized?: boolean
  readonly loader?: (props: Readonly<{ src: string; width: number; quality: number }>) => string
  readonly overrideSrc?: string
  readonly decoding?: 'async' | 'sync' | 'auto'
}

function positive(value: number | undefined): number | undefined {
  return value != null && value !== 0 ? value : undefined
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Solid props object
export function Image(props: ImageProps): JSX.Element {
  const [blurComplete, setBlurComplete] = createSignal(false)
  const [showAltText, setShowAltText] = createSignal(false)

  const quality = () => props.quality ?? 75
  const placeholder = () => props.placeholder ?? 'empty'
  const loading = () => props.loading ?? 'lazy'
  const fill = () => props.fill ?? false
  const imgSrc = () => (typeof props.src === 'string' ? props.src : props.src.src)
  const finalSrc = () =>
    props.overrideSrc != null && props.overrideSrc !== '' ? props.overrideSrc : imgSrc()
  const intrinsicWidth = () => (typeof props.src === 'string' ? undefined : props.src.width)
  const intrinsicHeight = () => (typeof props.src === 'string' ? undefined : props.src.height)
  const imgWidth = () => positive(props.width) ?? (fill() ? undefined : positive(intrinsicWidth()))
  const imgHeight = () =>
    positive(props.height) ?? (fill() ? undefined : positive(intrinsicHeight()))
  const blurUrl = () =>
    props.blurDataURL != null && props.blurDataURL !== ''
      ? props.blurDataURL
      : typeof props.src === 'string'
        ? undefined
        : props.src.blurDataURL

  const sizePlan = createMemo(() =>
    resolveOptimizedSizePlan({
      fill: fill(),
      width: props.width,
      intrinsicWidth: intrinsicWidth(),
    }),
  )
  const useSrcSet = () => {
    const plan = sizePlan()
    return plan.widths.length > 1 || plan.widths[0] !== plan.defaultWidth
  }

  const handleLoad = (event: Event) => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- currentTarget is the <img> this handler is bound to
    const img = event.currentTarget as HTMLImageElement
    if (img.src && img.complete) {
      if (placeholder() === 'blur') setBlurComplete(true)
      props.onLoad?.(event)
    }
  }
  const handleError = (event: Event) => {
    setShowAltText(true)
    if (placeholder() === 'blur') setBlurComplete(true)
    props.onError?.(event)
  }

  createEffect(() => {
    if (props.preload !== true) return

    const link = document.createElement('link')
    link.rel = 'preload'
    link.as = 'image'

    const plan = sizePlan()
    const { loader } = props
    const src = finalSrc()
    const responsive = useSrcSet() && props.unoptimized !== true
    const avifOnly = loader == null && DEFAULT_FORMATS.length === 1 && DEFAULT_FORMATS[0] === 'avif'
    const format: ImageFormat | undefined = avifOnly ? 'avif' : undefined
    const sizes =
      props.sizes != null && props.sizes !== ''
        ? props.sizes
        : responsive || fill()
          ? '100vw'
          : undefined

    if (props.unoptimized === true) {
      link.href =
        loader != null ? loader({ src, width: plan.defaultWidth, quality: quality() }) : src
    } else if (responsive) {
      link.href =
        loader != null
          ? loader({ src, width: plan.defaultWidth, quality: quality() })
          : buildImageUrl(src, plan.defaultWidth, quality(), format)
      link.setAttribute(
        'imagesrcset',
        DEFAULT_DEVICE_SIZES.map(
          w =>
            `${loader != null ? loader({ src, width: w, quality: quality() }) : buildImageUrl(src, w, quality(), format)} ${w}w`,
        ).join(', '),
      )
      if (avifOnly) link.type = 'image/avif'
    } else {
      link.href =
        loader != null
          ? loader({ src, width: plan.defaultWidth, quality: quality() })
          : buildImageUrl(src, plan.defaultWidth, quality())
    }
    if (sizes != null) link.setAttribute('imagesizes', sizes)

    document.head.append(link)
    onCleanup(() => {
      link.remove()
    })
  })

  const imgStyle = (): JSX.CSSProperties => {
    const base: JSX.CSSProperties = { ...props.style }
    if (fill()) {
      Object.assign(base, {
        'position': 'absolute',
        'inset': 0,
        'width': '100%',
        'height': '100%',
        'object-fit': props.style?.['object-fit'] ?? 'cover',
      })
    }
    if (placeholder() === 'blur') {
      const blur = blurUrl()
      if (blurComplete()) {
        Object.assign(base, { filter: 'none', transition: 'filter 0.3s ease-out' })
      } else if (blur != null && blur !== '') {
        Object.assign(base, {
          'background-image': `url(${blur})`,
          'background-size': 'cover',
          'background-position': 'center',
          'filter': 'blur(20px)',
          'transition': 'filter 0.3s ease-out',
        })
      }
    }
    return base
  }

  const srcSet = (format?: ImageFormat) => {
    const { loader } = props
    const { widths } = sizePlan()
    return widths
      .map(
        w =>
          `${loader != null ? loader({ src: finalSrc(), width: w, quality: quality() }) : buildImageUrl(finalSrc(), w, quality(), format)} ${w}w`,
      )
      .join(', ')
  }
  const mainSrc = () => {
    const width = sizePlan().defaultWidth
    if (props.unoptimized === true)
      return props.loader != null
        ? props.loader({ src: finalSrc(), width, quality: quality() })
        : finalSrc()
    return props.loader != null
      ? props.loader({ src: finalSrc(), width, quality: quality() })
      : buildImageUrl(finalSrc(), width, quality())
  }
  const resolvedSizes = () =>
    props.sizes != null && props.sizes !== '' ? props.sizes : useSrcSet() ? '100vw' : undefined
  const optimizedSet = () => props.unoptimized !== true && useSrcSet()

  const img = () => (
    <img
      src={mainSrc()}
      srcset={optimizedSet() ? srcSet() : undefined}
      sizes={optimizedSet() ? resolvedSizes() : undefined}
      alt={showAltText() ? props.alt : ''}
      width={fill() ? undefined : imgWidth()}
      height={fill() ? undefined : imgHeight()}
      loading={props.preload === true ? 'eager' : loading()}
      fetchpriority={props.preload === true ? 'high' : 'auto'}
      decoding={props.decoding ?? (props.preload === true ? 'sync' : 'async')}
      onLoad={placeholder() === 'blur' || props.onLoad != null ? handleLoad : undefined}
      onError={handleError}
      style={imgStyle()}
      class={props.class}
    />
  )

  return (
    <Show when={optimizedSet()} fallback={img()}>
      <picture>
        <Show when={DEFAULT_FORMATS.includes('avif')}>
          <source type="image/avif" srcset={srcSet('avif')} sizes={resolvedSizes()} />
        </Show>
        <Show when={DEFAULT_FORMATS.includes('webp')}>
          <source type="image/webp" srcset={srcSet('webp')} sizes={resolvedSizes()} />
        </Show>
        {img()}
      </picture>
    </Show>
  )
}
