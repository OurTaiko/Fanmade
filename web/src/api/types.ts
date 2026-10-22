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
  /** The song the comment is on, or (for a 段位 course) the course. */
  chartId?: string
  chartTitle?: string
  danId?: string
  danTitle?: Record<string, string>
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
  | 'comment_reply'
  | 'chart_comment'
  | 'chart_upvotes'
  | 'dan_comment'
  | 'dan_upvotes'
  | 'comment_upvotes'
  | 'comment_removed'
export type AppNotification = {
  id: string
  // Unknown future kinds still render with a generic message.
  kind: NotificationKind | (string & {})
  createdAt: string
  read: boolean
  actor: { id: string; nickname: string; avatarUrl?: string } | null
  chart: { id: string; title: string } | null
  dan: { id: string; title: Record<string, string> } | null
  comment: { id: string; parentId: string | null; excerpt: string } | null
  data: {
    upvotes?: number
    /** upload_result: outcome of an upload the user did not wait for. */
    status?: 'published' | 'updated' | 'failed' | (string & {})
    title?: string
    code?: string
    failedFiles?: { file: string; code: string }[]
    /** playlist_removed: the deleted playlist's name. */
    name?: string
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
  /** The ranked chart block; `course` and `side` describe it. */
  difficultyId: number
  course: string
  side: string
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
  /** Public playlists only. */
  playlistCount: number
}
export type UserDirectory = {
  items: PublicUser[]
  total: number
  page: number
  pageSize: number
  profilesAvailable: boolean
}

export type UserSpace = { user: PublicUser; profilesAvailable: boolean }

/** System playlists are computed by the server: no owner, read-only. */
export type Playlist = {
  id: string
  name: string
  description: string
  public: boolean
  system: boolean
  categoryId: string
  genre: string
  ownerId?: string
  owner: { id: string; nickname: string; avatarUrl?: string } | null
  coverHash?: string
  chartCount: number
  favoriteCount: number
  favorited: boolean
  createdAt: string | null
  updatedAt: string | null
  /** Only in the viewer's own list when it asks about one song. */
  containsChart?: boolean
  /** Only in the detail response, in playlist order. */
  charts?: Chart[]
}
export type PlaylistPage = { items: Playlist[]; total: number; page: number; pageSize: number }
export type MyPlaylists = {
  owned: Playlist[]
  favorites: Playlist[]
  maxPlaylists: number
  maxItems: number
}

// 段位 courses (OurTaikoPlay's course format, as GET /api/v1/dans returns them).
export type DanExamType = 'gauge' | 'good' | 'ok' | 'bad' | 'hits' | 'score' | 'combo' | 'rolls'
export type DanExam = {
  type: DanExamType
  range: 'more' | 'less'
  // [red] or [red, gold] for the course, or one such (or null) per song.
  value: number[] | (number[] | null)[]
}
export type DanRewardTitle = {
  id: string
  on: 'red' | 'red1' | 'red2' | 'red3' | 'gold' | 'gold4' | 'gold5' | 'gold6'
}
export type DanSong = {
  chart: {
    id: string | number
    course: 'Easy' | 'Normal' | 'Hard' | 'Oni' | 'Edit'
    tjaHash: string
  }
  title: string
  subtitle: string
  hidden: boolean
  level: number
  available: boolean
}
export type Dan = {
  id: string
  title: Record<string, string>
  color: number
  official: boolean
  songs: DanSong[]
  exams: DanExam[]
  rewards: { dan?: number; titles?: DanRewardTitle[] }
  ownerId: string
  owner: string
  createdAt: string
  updatedAt: string
  score: number
  upvotes: number
  downvotes: number
  commentCount: number
  myVote: Vote
}
export type DanInput = {
  title: Record<string, string>
  color: number
  songs: { chartId: string; course: string; hidden: boolean }[]
  exams: DanExam[]
  rewards: { dan?: number; titles?: DanRewardTitle[] }
}
