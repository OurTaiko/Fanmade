import { useTranslation } from 'react-i18next'
import { LanguageProvider, DocumentLanguage } from './language'
import { I18nextProvider } from 'react-i18next'
import { i18n } from './i18n'
import { StrictMode } from 'react'
import { IconContext } from '@phosphor-icons/react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { SessionProvider } from './session'
import { Layout } from '@/components/layout'
import { Auth, Detail, Library } from './pages'
import { UpdatePage, UploadPage } from './upload'
import { NotificationProvider } from './notifications'
import { CategoryProvider } from './categories'
import { ProfilePage } from './profile'
import { UsersPage } from './users'
import { UserSpacePage } from './user-space'
import { NotificationsPage } from './notification-center'
import { MyPlaylistsPage, PlaylistPage, PlaylistsPage } from './playlists'
import './styles.css'
import { ThemeProvider } from './theme'
function App() {
  const { t } = useTranslation()

  return (
    <StrictMode>
      <IconContext.Provider value={{ weight: 'bold' }}>
        <ThemeProvider>
          <BrowserRouter>
            <NotificationProvider>
              <SessionProvider>
                <LanguageProvider>
                  <DocumentLanguage />
                  <CategoryProvider>
                    <Routes>
                      <Route element={<Layout />}>
                        <Route index element={<Library />} />
                        <Route path="users" element={<UsersPage />} />
                        <Route path="users/:id" element={<UserSpacePage />} />
                        <Route path="me/profile" element={<ProfilePage />} />
                        <Route path="me/charts" element={<Library mine />} />
                        <Route path="playlists" element={<PlaylistsPage />} />
                        <Route path="playlists/:id" element={<PlaylistPage />} />
                        <Route path="me/playlists" element={<MyPlaylistsPage />} />
                        <Route path="upload" element={<UploadPage />} />
                        <Route path="charts/:id/update" element={<UpdatePage />} />
                        <Route path="charts/:id" element={<Detail />} />
                        <Route path="charts/:id/comments/:commentId" element={<Detail />} />
                        <Route path="notifications" element={<NotificationsPage />} />
                        <Route path="login" element={<Auth key="login" />} />
                        <Route path="register" element={<Auth key="register" register />} />
                        <Route
                          path="*"
                          element={
                            <div className="flex flex-col items-center justify-center gap-4 rounded-3xl border border-dashed bg-card/60 px-6 py-16 text-center [&>p]:max-w-lg [&>p]:text-muted-foreground">
                              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                                {t('messages.pageNotFound')}
                              </h1>
                              <Link to="/">{t('messages.backToExplore')}</Link>
                            </div>
                          }
                        />
                      </Route>
                    </Routes>
                  </CategoryProvider>
                </LanguageProvider>
              </SessionProvider>
            </NotificationProvider>
          </BrowserRouter>
        </ThemeProvider>
      </IconContext.Provider>
    </StrictMode>
  )
}
createRoot(document.getElementById('root')!).render(
  <I18nextProvider i18n={i18n}>
    <App />
  </I18nextProvider>,
)
