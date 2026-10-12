import { apiErrorMessage } from './error-message'
import { t } from '../i18n'
import { endpoints } from './endpoints'
import type { Chart } from './types'

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly retryAfter = 0,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
export async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { credentials: 'include', ...init })
  const data = await response.json().catch(() => ({
    code: response.status === 413 ? 'FILE_TOO_LARGE' : 'SERVICE_UNAVAILABLE',
    message:
      response.status === 413
        ? t('messages.fileExceedsTheUploadSizeLimit')
        : t('messages.unexpectedServerResponsePleaseTryAgainLater'),
  }))
  if (!response.ok)
    throw new ApiError(apiErrorMessage(data), Number(response.headers.get('Retry-After')) || 0)
  return data as T
}
export function jsonRequest(method: string, body: unknown, csrf = ''): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify(body),
  }
}
export function uploadChart(
  form: FormData,
  csrf: string,
  key: string,
  signal: AbortSignal,
  onProgress: (n: number) => void,
  replaceChartId?: string,
): Promise<Chart | { status: 'processing' }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(
      replaceChartId ? 'PUT' : 'POST',
      replaceChartId ? endpoints.chartFiles(replaceChartId) : endpoints.charts,
    )
    xhr.withCredentials = true
    xhr.setRequestHeader('X-CSRF-Token', csrf)
    xhr.setRequestHeader('Idempotency-Key', key)
    // The server decodes and stores the files after replying; the outcome
    // arrives as a notification, so the uploader need not stay on the page.
    xhr.setRequestHeader('Prefer', 'respond-async')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText)
        if (xhr.status >= 200 && xhr.status < 300) resolve(data)
        else reject(new Error(apiErrorMessage(data)))
      } catch {
        reject(
          new Error(
            xhr.status === 413
              ? t('messages.fileExceedsTheUploadSizeLimit')
              : t('messages.unexpectedServerResponsePleaseRetry'),
          ),
        )
      }
    }
    xhr.onerror = () =>
      reject(new Error(t('messages.connectionLostRetryTheSameRequestWillNotSaveDuplicates')))
    xhr.onabort = () =>
      reject(new Error(t('messages.waitingCancelledIfSavedAlreadyRetryingReturnsTheSavedChart')))
    xhr.ontimeout = () => reject(new Error(t('messages.requestTimedOutPleaseRetryLater')))
    xhr.timeout = 240000
    const abort = () => xhr.abort()
    signal.addEventListener('abort', abort, { once: true })
    xhr.onloadend = () => signal.removeEventListener('abort', abort)
    if (signal.aborted) {
      reject(new Error(t('messages.uploadCancelled')))
      return
    }
    xhr.send(form)
  })
}
