import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { ChatPage } from '@/pages/ChatPage'
import { UsageLayout } from '@/pages/usage/UsageLayout'
import { PersonalPage } from '@/pages/usage/PersonalPage'
import { LeaderboardPage } from '@/pages/usage/LeaderboardPage'
import { UsersPage } from '@/pages/usage/UsersPage'
import { ModelsPage } from '@/pages/usage/ModelsPage'
import { AnalyticsPage } from '@/pages/usage/AnalyticsPage'
import { ApiKeysPage } from '@/pages/ApiKeysPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<ChatPage />} />
          <Route path="c/:chatId" element={<ChatPage />} />
          <Route path="usage" element={<UsageLayout />}>
            <Route index element={<PersonalPage />} />
            <Route path="leaderboard" element={<LeaderboardPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="models" element={<ModelsPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
          </Route>
          <Route path="api-keys" element={<ApiKeysPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
