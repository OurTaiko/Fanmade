import type { ReactNode } from 'react'
import ka from '@/assets/donder/sticker_2.png'

// An empty list or missing page: the ka sticker beside a short line.
export function EmptyState({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 bg-cream px-6 py-12 border-[1.5px] border-input border-dashed rounded-[14px] text-center">
      <img src={ka} alt="" aria-hidden="true" className="w-20" />
      <h2 className="font-extrabold text-base">{title}</h2>
      {children}
    </div>
  )
}
