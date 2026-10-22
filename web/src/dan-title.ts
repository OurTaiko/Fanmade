// The course's name in the page's language, else Japanese, else any.
export function danTitle(title: Record<string, string>, language?: string) {
  const key = language?.startsWith('zh') ? 'zh' : (language ?? '').split('-')[0]
  return title[key] || title.ja || Object.values(title).find(Boolean) || '—'
}
