import { API_ROOT } from './config'
import type { Chart } from './types'

function withQuery(url: string, values: Record<string, string | number>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) query.set(key, String(value))
  return query.size ? `${url}?${query}` : url
}

const chartPath = (id: string) => `${API_ROOT}/charts/${encodeURIComponent(id)}`
const playlistPath = (id: string) => `${API_ROOT}/playlists/${encodeURIComponent(id)}`

export const endpoints = {
  me: `${API_ROOT}/me`,
  users: (query: { q: string; sort: string; page: number }) =>
    withQuery(`${API_ROOT}/users`, query),
  user: (id: string) => `${API_ROOT}/users/${encodeURIComponent(id)}`,
  categories: `${API_ROOT}/categories`,
  uploadRules: `${API_ROOT}/upload-rules`,
  logout: `${API_ROOT}/auth/logout`,
  login: (returnTo: string) => withQuery(`${API_ROOT}/auth/sso/login`, { returnTo }),
  accountRegister: `${API_ROOT}/auth/account/register`,
  accountProfile: `${API_ROOT}/auth/account/profile`,
  charts: `${API_ROOT}/charts`,
  chartList: (
    query: {
      q: string
      order?: string
      page: number
      owner?: string
    },
    mine = false,
  ) => withQuery(`${API_ROOT}${mine ? '/me/charts' : '/charts'}`, query),
  chart: chartPath,
  collaborations: (id: string) => `${chartPath(id)}/collaborations`,
  chartOwnership: (id: string) => `${chartPath(id)}/owners/me`,
  respondCollaboration: (id: string) =>
    `${API_ROOT}/me/notifications/${encodeURIComponent(id)}/respond`,
  chartFiles: (id: string) => `${chartPath(id)}/files`,
  cover: (id: string, hash?: string) =>
    withQuery(`${chartPath(id)}/cover`, hash ? { v: hash } : {}),
  leaderboard: (id: string, query: { difficultyId?: number; page: number }) =>
    withQuery(`${chartPath(id)}/leaderboard`, query),
  chartVote: (id: string) => `${chartPath(id)}/vote`,
  chartComments: (id: string, query: { sort: string; page: number }) =>
    withQuery(`${chartPath(id)}/comments`, query),
  newComment: (chartId: string) => `${chartPath(chartId)}/comments`,
  comment: (id: string) => `${API_ROOT}/comments/${encodeURIComponent(id)}`,
  commentThread: (id: string, sort: string) =>
    withQuery(`${API_ROOT}/comments/${encodeURIComponent(id)}`, { sort }),
  commentVote: (id: string) => `${API_ROOT}/comments/${encodeURIComponent(id)}/vote`,
  userComments: (id: string, query: { sort: string; page: number }) =>
    withQuery(`${API_ROOT}/users/${encodeURIComponent(id)}/comments`, query),
  notifications: (query: { filter: 'all' | 'unread'; page: number }) =>
    withQuery(`${API_ROOT}/me/notifications`, query),
  notificationsUnread: `${API_ROOT}/me/notifications/unread`,
  notificationsRead: `${API_ROOT}/me/notifications/read`,
  notification: (id: string) => `${API_ROOT}/me/notifications/${encodeURIComponent(id)}`,
  notificationSettings: `${API_ROOT}/me/notification-settings`,
  resources: (id: string) => `${chartPath(id)}/resources`,
  playlists: `${API_ROOT}/playlists`,
  playlistList: (query: { q: string; sort: string; page: number; owner?: string }) =>
    withQuery(`${API_ROOT}/playlists`, query),
  systemPlaylists: `${API_ROOT}/playlists/system`,
  myPlaylists: (chart?: string) => withQuery(`${API_ROOT}/me/playlists`, chart ? { chart } : {}),
  playlist: playlistPath,
  playlistCover: (id: string, hash?: string) =>
    withQuery(`${playlistPath(id)}/cover`, hash ? { v: hash } : {}),
  playlistItem: (id: string, chart: string) =>
    `${playlistPath(id)}/items/${encodeURIComponent(chart)}`,
  playlistOrder: (id: string) => `${playlistPath(id)}/order`,
  playlistFavorite: (id: string) => `${playlistPath(id)}/favorite`,
  resource: (chart: Pick<Chart, 'id'>, kind: 'audio' | 'tja' | 'movie') =>
    `${chartPath(chart.id)}/${kind}`,
} as const
