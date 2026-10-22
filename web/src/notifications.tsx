import { useTranslation } from 'react-i18next'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  CheckCircleIcon as CheckCircle2,
  WarningCircleIcon as CircleAlert,
  InfoIcon as Info,
  XIcon as X,
} from '@phosphor-icons/react'
import { NotificationContext, useNotification } from './notification-context'
import type { Notification, NoticeKind } from './notification-context'

export function Modal({
  title,
  children,
  actions,
  onDismiss,
  busy = false,
  alert = false,
  className,
  initialFocus,
  finalFocus,
}: {
  title: string
  children: ReactNode
  actions?: ReactNode
  onDismiss: () => void
  busy?: boolean
  alert?: boolean
  className?: string
  initialFocus?: RefObject<HTMLElement | null>
  finalFocus?: RefObject<HTMLElement | null>
}) {
  const { t } = useTranslation()

  const descriptionId = useId()
  const [previousFocus] = useState(() => document.activeElement as HTMLElement | null)
  return (
    <Dialog
      defaultOpen
      disablePointerDismissal={busy}
      onOpenChange={(_open, details) => {
        if (busy) {
          details.cancel()
        }
      }}
      onOpenChangeComplete={(open) => {
        if (!open) onDismiss()
      }}
    >
      <DialogContent
        aria-describedby={descriptionId}
        role={alert ? 'alertdialog' : 'dialog'}
        showCloseButton={false}
        initialFocus={initialFocus}
        finalFocus={() => {
          if (finalFocus?.current?.isConnected && !finalFocus.current.matches(':disabled'))
            return finalFocus.current
          if (previousFocus?.isConnected && !previousFocus.matches(':disabled'))
            return previousFocus
          return document.querySelector<HTMLElement>(
            '[data-slot="dialog-content"] input:not(:disabled)',
          )
        }}
        className={cn('max-h-[85svh] overflow-y-auto', className)}
      >
        <DialogHeader className="flex-row items-center justify-between gap-4">
          <DialogTitle>{title}</DialogTitle>
          <DialogClose
            render={<Button type="button" variant="ghost" size="icon-sm" />}
            aria-label={t('messages.dismissNotification')}
            disabled={busy}
          >
            <X />
          </DialogClose>
        </DialogHeader>
        <div id={descriptionId} className="min-w-0 space-y-4 text-sm leading-relaxed wrap-anywhere">
          {children}
        </div>
        {actions !== null && (
          <DialogFooter>
            {actions ?? (
              <DialogClose render={<Button type="button" />} disabled={busy}>
                {t('messages.gotIt')}
              </DialogClose>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()

  const [queue, setQueue] = useState<(Notification & { id: string })[]>([])
  const sequence = useRef(0)
  const dismiss = useCallback(
    (id: string) => setQueue((items) => items.filter((item) => item.id !== id)),
    [],
  )
  const publish = useCallback((id: string, notice: Notification) => {
    setQueue((items) => {
      if (!items.some((item) => item.id === id)) return [...items, { ...notice, id }]
      return items.map((item) => (item.id === id ? { ...notice, id } : item))
    })
  }, [])
  const notify = useCallback(
    (message: ReactNode, kind: NoticeKind = 'info', title = '') => {
      publish(`event-${++sequence.current}`, { message, kind, title })
    },
    [publish],
  )
  const value = useMemo(() => ({ publish, dismiss, notify }), [publish, dismiss, notify])
  const current = queue[0]
  const Icon =
    current?.kind === 'error' ? CircleAlert : current?.kind === 'success' ? CheckCircle2 : Info
  return (
    <NotificationContext.Provider value={value}>
      {children}
      {current && (
        <Modal
          key={current.id}
          title={
            current.title ||
            (current.kind === 'error'
              ? t('messages.actionIncomplete')
              : current.kind === 'success'
                ? t('messages.success')
                : t('messages.notice'))
          }
          alert={current.kind === 'error'}
          onDismiss={() => dismiss(current.id)}
        >
          <div className="flex items-start gap-3 [&>svg]:shrink-0 [&>svg]:text-muted-foreground">
            <Icon size={26} aria-hidden="true" />
            <div>{current.message}</div>
          </div>
        </Modal>
      )}
    </NotificationContext.Provider>
  )
}

// Unmounting a source (navigation, retry, changed selection) removes its queued message.
export function Notice({
  children,
  kind = 'error',
  title = '',
}: {
  children: ReactNode
  kind?: NoticeKind
  title?: string
}) {
  const { publish, dismiss } = useNotification()
  const id = useId()
  useEffect(() => {
    publish(id, { message: children, kind, title })
    return () => dismiss(id)
  }, [children, kind, title, id, publish, dismiss])
  return null
}
