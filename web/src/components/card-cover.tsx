import { useState } from 'react'

// Text drawn over a card's cover keeps a halo in the card's own colour.
export const coveredTextClassName =
  '[text-shadow:0_1px_3px_rgb(255_255_255/0.9)] dark:[text-shadow:0_1px_3px_rgb(0_0_0/0.9)]'

// The cover a card shows: `source`, unless there is none or it failed to load.
export function useCardCover(source?: string) {
  const [failedSource, setFailedSource] = useState('')
  return {
    source: source && failedSource !== source ? source : undefined,
    onError: () => setFailedSource(source ?? ''),
  }
}

// A cover filling a card (inside a `group` link) behind its `relative` content,
// washed out so the text stays readable.
export function CardCoverBackdrop({ source, onError }: { source: string; onError: () => void }) {
  return (
    <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
      <img
        src={source}
        alt=""
        loading="lazy"
        decoding="async"
        className="size-full object-cover motion-reduce:transform-none group-hover:scale-105 transition-transform motion-reduce:transition-none duration-500 ease-[cubic-bezier(0.25,0.1,0.25,1)]"
        onError={onError}
      />
      <div className="absolute inset-0 bg-card/70 group-hover:bg-card/60 transition-colors motion-reduce:transition-none duration-500 ease-[cubic-bezier(0.25,0.1,0.25,1)]" />
    </div>
  )
}
