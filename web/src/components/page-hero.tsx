import type { ReactNode } from 'react'
import background from '@/assets/donder/bg.webp'
import don from '@/assets/donder/sticker_1.png'
import ka from '@/assets/donder/sticker_2.png'

// The home banner: the OurTaikoPlay website's background, an outlined title and
// the don/ka stickers, closed by the drum stripe.
export function PageHero({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section className="isolate relative -mx-4 sm:-mx-6 lg:-mx-8 -mt-8 overflow-hidden">
      <img
        src={background}
        alt=""
        aria-hidden="true"
        className="-z-20 absolute inset-0 opacity-70 dark:opacity-25 size-full object-cover object-[center_62%]"
      />
      <div aria-hidden="true" className="-z-10 absolute inset-0 bg-background/80" />
      <div className="flex items-center gap-8 mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12 max-w-7xl">
        <div className="flex-1 space-y-6 min-w-0">
          <h1 className="font-extrabold text-(--hero) text-4xl sm:text-5xl lg:text-6xl leading-tight [-webkit-text-stroke:6px_var(--outline)] [paint-order:stroke_fill] drop-shadow-[0_3px_0_var(--outline)]">
            {title}
          </h1>
          {children}
        </div>
        <div aria-hidden="true" className="hidden md:flex items-center shrink-0">
          <img src={don} alt="" className="w-44 -rotate-8" />
          <img src={ka} alt="" className="-ml-8 w-40 rotate-9 translate-y-4" />
        </div>
      </div>
      <div className="drum-stripe" />
    </section>
  )
}
