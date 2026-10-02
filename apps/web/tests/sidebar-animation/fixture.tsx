import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import '../../src/index.css'
import '../../src/i18n'
import { AppLayout } from '../../src/components/layout/AppLayout'
import { useChat } from '../../src/stores/chat'
import { useAuth } from '../../src/stores/auth'
import { useSidePanel } from '../../src/features/side-panel/store'
import { queryClient } from '../../src/lib/query-client'
import { startAnimationSpeedController } from '../../src/lib/animation-speed'

// Real layout, sidebar, rows, panel, and stores; synthetic local data with no account/network.
const count = Number(new URLSearchParams(location.search).get('chats') ?? 200)
useAuth.setState({ user: null, filesEnabled: true })
useChat.setState({ chats: Array.from({ length: count }, (_, index) => ({
  id: `chat-${index}`, title: `Conversation ${index}`, modelId: 'benchmark', messages: [],
  createdAt: index, updatedAt: index, pinned: false, folderId: null, sortOrder: index,
  tags: [], temporary: false, expiresAt: null, expired: false,
})) })
queryClient.setQueryData(['files', undefined, 'folder', 'root'], { folder: null, ancestors: [], children: [] })
startAnimationSpeedController(1)
Object.assign(window, {
  benchmarkPanel: (open: boolean) => open ? useSidePanel.getState().open({ kind: 'folder', id: null }) : useSidePanel.getState().close(),
  benchmarkSplitAvailable: () => useSidePanel.getState().splitAvailable,
})
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <MemoryRouter><Routes><Route element={<AppLayout />}>
      <Route index element={<div className="h-full p-8"><h1>Sidebar animation</h1><textarea aria-label="Draft" defaultValue="Keep this draft" /></div>} />
    </Route></Routes></MemoryRouter>
  </QueryClientProvider>,
)
