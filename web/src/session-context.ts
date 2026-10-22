import { createContext, useContext } from 'react'
import type { Session } from './api/types'
export type SessionState = Session & {
  loading: boolean
  error: string
  setSession: (session: Session) => void
  logout: () => Promise<void>
}
export const SessionContext = createContext<SessionState | null>(null)
export function useSession() {
  const value = useContext(SessionContext)
  if (!value) throw new Error('SessionProvider missing')
  return value
}
