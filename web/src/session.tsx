import { endpoints } from '@/api/endpoints'
import { useLocation } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { SessionContext } from './session-context'
import type { ReactNode } from 'react'
import { api, jsonRequest } from './api/client'
import type { Session } from './api/types'
export function SessionProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const [session, setSession] = useState<Session>({ user: null, csrfToken: '' })
  const [loading, setLoading] = useState(true),
    [error, setError] = useState('')
  const revision = useRef(0)
  useEffect(() => {
    let controller: AbortController | undefined
    const refresh = () => {
      if (document.visibilityState === 'hidden') return
      controller?.abort()
      const current = new AbortController()
      controller = current
      const startedAt = revision.current
      api<Session>(endpoints.me, { signal: current.signal })
        .then((next) => {
          if (!current.signal.aborted && startedAt === revision.current) {
            setSession(next)
            setError('')
          }
        })
        .catch((e) => {
          if (!current.signal.aborted && startedAt === revision.current) setError(e.message)
        })
        .finally(() => {
          if (!current.signal.aborted && startedAt === revision.current) setLoading(false)
        })
    }
    refresh()
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      controller?.abort()
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [pathname])
  const logout = async () => {
    await api(endpoints.logout, jsonRequest('POST', {}, session.csrfToken))
    revision.current++
    setError('')
    setSession({ user: null, csrfToken: '' })
  }
  return (
    <SessionContext.Provider value={{ ...session, loading, error, setSession, logout }}>
      {children}
    </SessionContext.Provider>
  )
}
