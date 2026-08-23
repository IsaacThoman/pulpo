import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { isDesktopRuntime } from '@/lib/runtime'

export function DesktopTitleBar() {
  const navigate = useNavigate()

  useEffect(() => {
    if (!window.pulpoDesktop) return
    return window.pulpoDesktop.onCommand((command) => {
      if (command === 'new-chat') navigate('/')
      if (command === 'settings') {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: true }))
      }
    })
  }, [navigate])

  if (!isDesktopRuntime()) return null
  return <div aria-hidden="true" className="desktop-titlebar fixed inset-x-0 top-0 z-[100] h-[38px]" />
}
