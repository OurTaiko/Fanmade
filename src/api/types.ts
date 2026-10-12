import type { Metadata } from '../tja'
export type User = {
  id: string
  username: string
  nickname: string
  emailVerified: boolean
  isAdmin: boolean
  preferredLanguage?: string
  avatarUrl?: string
}
export type Locale = 'en' | 'ja' | 'zh' | 'ko'
export type Session = { user: User | null; csrfToken: string }
export type Category = { id: string; title: string; genre: string }
export type Chart = Metadata & {
  demoEnd?: number
  previewPath?: string
  id: string
  coverHash?: string
  categoryIds: string[]
  ownerIds?: string[]
  owners?: { id: string; nickname: string; avatarUrl?: string }[]
  /** Original uploader; use ownerIds for ownership. */
  ownerId: string
  uploader: string
  uploaderAvatarUrl?: string
  description: string
  createdAt: string
  duration: number
  encoding: string
  tjaName: string
  audioName: string
  tjaHash: string
  audioHash: string
  audioSize: number
  /** Transcoded background movie; absent when the chart has none. */
  movieHash?: string
  movieSize?: number
  titleTranslations: Partial<Record<Locale, string>>
  subtitleTranslations: Partial<Record<Locale, string>>
  score: number
  upvotes: number
  downvotes: number
  commentCount: number
  myVote: Vote
}
export type Vote = -1 | 0 | 1
export type VoteResult = { score: number; upvotes?: number; downvotes?: number; myVote: Vote }
export type CommentSort = 'best' | 'top' | 'new' | 'old' | 'controversial'
export type Comment = {
  id: string
  chartId: string
  chartTitle?: string
  parentId: string | null
  depth: number
  authorId: string
  author: string
  authorAvatarUrl?: string
  body: string
  createdAt: string
  editedAt: string | null
  deleted: boolean
  removed: boolean
  score: number
  myVote: Vote
  replyCount: number
  replies: Comment[]
}
export type CommentPage = {
  items: Comment[]
  total: number
  commentCount: number
  page: number
  pageSize: number
  sort: CommentSort
}
export type CommentThread = { item: Comment; sort: CommentSort }
export type CommentList = { items: Comment[]; total: number; page: number; pageSize: number }
export type NotificationKind =
  'comment_reply' | 'chart_comment' | 'chart_upvotes' | 'comment_upvotes' | 'comment_removed'
export type AppNotification = {
  id: string
  // Unknown future kinds still render with a generic message.
  kind: NotificationKind | (string & {})
  createdAt: string
  read: boolean
  actor: { id: string; nickname: string; avatarUrl?: string } | null
  chart: { id: string; title: string } | null
  comment: { id: string; parentId: string | null; excerpt: string } | null
  data: {
    upvotes?: number
    /** upload_result: outcome of an upload the user did not wait for. */
    status?: 'published' | 'updated' | 'failed' | (string & {})
    title?: string
    code?: string
    failedFiles?: { file: string; code: string }[]
  } & Record<string, unknown>
}
export type NotificationPage = {
  items: AppNotification[]
  total: number
  unread: number
  page: number
  pageSize: number
}
export type NotificationSetting = { kind: NotificationKind | (string & {}); enabled: boolean }
export type ChartList = { items: Chart[]; total: number; page: number; pageSize: number }
export type LeaderboardEntry = {
  id: string
  userId: string
  nickname: string
  avatarUrl?: string
  rank: number
  score: number
  good: number
  ok: number
  bad: number
  drumroll: number
  submittedAt: string
}
export type Leaderboard = {
  songId: string
  difficulty: string
  supported: boolean
  items: LeaderboardEntry[]
  total: number
  page: number
  pageSize: number
}

export type PublicUser = {
  id: string
  nickname: string | null
  avatarUrl?: string
  firstLoginAt: string | null
  lastActiveAt: string | null
  chartCount: number
  scoreCount: number
  commentCount: number
  karma: number
}
export type UserDirectory = {
  items: PublicUser[]
  total: number
  page: number
  pageSize: number
  profilesAvailable: boolean
}

export type UserSpace = { user: PublicUser; profilesAvailable: boolean }
