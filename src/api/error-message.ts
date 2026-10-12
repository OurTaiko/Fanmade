import { i18n, normalizeLanguage, t } from '../i18n'
import type zh from '../locales/zh-Hans.json'

type ErrorCode = keyof typeof zh.errors
const aliases: Record<string, ErrorCode> = {
  CHART_NOT_FOUND: 'NOT_FOUND',
  USER_NOT_FOUND: 'NOT_FOUND',
  RESOURCE_NOT_FOUND: 'NOT_FOUND',
  VERSION_NOT_FOUND: 'NOT_FOUND',
  CATEGORY_NOT_FOUND: 'NOT_FOUND',
  COVER_NOT_FOUND: 'NOT_FOUND',
  DIFFICULTY_NOT_FOUND: 'NOT_FOUND',
  CHART_REMOVED: 'NOT_FOUND',
  COMMENT_NOT_FOUND: 'NOT_FOUND',
  NOTIFICATION_NOT_FOUND: 'NOT_FOUND',
  PLAYLIST_NOT_FOUND: 'NOT_FOUND',
  PLAYLIST_INVALID: 'REQUEST_INVALID',
  CATEGORY_INVALID: 'CATEGORIES_INVALID',
  NOTIFICATION_KIND_INVALID: 'REQUEST_INVALID',
  VOTE_INVALID: 'REQUEST_INVALID',
  INTERNAL_ERROR: 'SERVICE_UNAVAILABLE',
  QUERY_INVALID: 'REQUEST_INVALID',
  DIFFICULTY_INVALID: 'REQUEST_INVALID',
  SCORE_INVALID: 'REQUEST_INVALID',
  IDEMPOTENCY_KEY_INVALID: 'REQUEST_INVALID',
  CONTENT_TYPE_INVALID: 'REQUEST_INVALID',
  ORIGIN_INVALID: 'REQUEST_INVALID',
  RETURN_PATH_INVALID: 'REQUEST_INVALID',
  FILE_SIZE_INVALID: 'FILE_TOO_LARGE',
}

/** Message for a stable protocol code that arrived without server text. */
export function errorCodeMessage(code: string): string {
  const key = aliases[code] ?? (code.startsWith('TJA_') ? 'TJA_INVALID' : code)
  return i18n.exists(`errors.${key}`)
    ? t(`errors.${key as ErrorCode}`)
    : t('messages.requestFailed')
}

// Translate the stable protocol code, never use server-provided text as a key.
export function apiErrorMessage(data: {
  code?: unknown
  message?: unknown
  line?: unknown
}): string {
  if (
    normalizeLanguage(i18n.resolvedLanguage) === 'zh-Hans' &&
    typeof data.message === 'string' &&
    data.message
  )
    return data.message
  const code = typeof data.code === 'string' ? data.code : ''
  const key = aliases[code] ?? (code.startsWith('TJA_') ? 'TJA_INVALID' : code)
  const message = i18n.exists(`errors.${key}`)
    ? t(`errors.${key as ErrorCode}`)
    : t('messages.requestFailed')
  return typeof data.line === 'number' && data.line > 0
    ? t('errors.LINE', { line: data.line, message })
    : message
}
