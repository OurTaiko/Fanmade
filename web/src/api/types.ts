// OurTaikoSiteKit's API types, then this site's Chart and the types built on it.
import type {
  ChartBase,
  ChartList as SharedChartList,
  MyPlaylists as SharedMyPlaylists,
  Playlist as SharedPlaylist,
  PlaylistPage as SharedPlaylistPage,
  Session as SharedSession,
  UserBase,
} from '@sitekit/api/types'
import type { Metadata } from '@sitekit/tja'

export * from '@sitekit/api/types'
export type User = UserBase
export type Session = SharedSession<User>
export type Chart = Metadata & ChartBase
export type ChartList = SharedChartList<Chart>
export type Playlist = SharedPlaylist<Chart>
export type PlaylistPage = SharedPlaylistPage<Chart>
export type MyPlaylists = SharedMyPlaylists<Chart>
