import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/api/client'
import { Button } from '@sitekit/components/ui/button'
import { CoverPicker } from '@/components/cover-picker'
import { Modal } from '@sitekit/notifications'
import { useSession } from '@/session-context'

// Uploads a cover to `endpoint` (PUT, multipart field "cover"). With
// `removeLabel` it also offers to remove the current cover (DELETE); both
// report the new cover hash, empty after a removal.
export function CoverUploadDialog({
  title,
  endpoint,
  removeLabel,
  onSaved,
  onDismiss,
}: {
  title: string
  endpoint: string
  removeLabel?: string
  onSaved: (coverHash: string) => void
  onDismiss: () => void
}) {
  const { t } = useTranslation()
  const { csrfToken } = useSession()
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const send = async (init: RequestInit) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await api<{ coverHash: string }>(endpoint, {
        ...init,
        headers: { 'X-CSRF-Token': csrfToken },
      })
      onSaved(result.coverHash)
      onDismiss()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const save = () => {
    if (!file) return
    const form = new FormData()
    form.append('cover', file)
    void send({ method: 'PUT', body: form })
  }
  return (
    <Modal
      title={title}
      busy={busy}
      onDismiss={onDismiss}
      actions={
        <>
          {removeLabel && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void send({ method: 'DELETE' })}
            >
              {removeLabel}
            </Button>
          )}
          <Button disabled={!file || busy} onClick={save}>
            {busy ? t('messages.saving') : t('messages.saveCover')}
          </Button>
        </>
      }
    >
      <CoverPicker
        file={file}
        onChange={(chosen) => {
          setFile(chosen)
          setError('')
        }}
        disabled={busy}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </Modal>
  )
}
