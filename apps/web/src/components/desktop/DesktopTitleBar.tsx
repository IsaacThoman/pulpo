import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { isDesktopRuntime } from '@/lib/runtime'
import { useAuth } from '@/stores/auth'

export function DesktopTitleBar() {
  const navigate = useNavigate()
  const instanceName = useAuth((state) => state.instanceName)
  const instanceUrl = useAuth((state) => state.instanceUrl)
  const instanceReady = useAuth((state) => state.instanceReady)
  const user = useAuth((state) => state.user)
  const chooseInstance = useAuth((state) => state.chooseInstance)

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
  return (
    <div className="desktop-titlebar fixed inset-x-0 top-0 z-[100] flex h-[38px] items-center justify-center text-xs text-muted-foreground">
      {instanceReady && user && <button
        type="button"
        className="desktop-no-drag absolute right-3 max-w-52 truncate rounded-md px-2 py-1 hover:bg-accent hover:text-foreground"
        title={`Switch from ${instanceUrl}`}
        onClick={() => {
          if (window.confirm('Switch Pulpo instances? You will be signed out of this instance.')) void chooseInstance()
        }}
      >
        {instanceName}
      </button>}
    </div>
  )
}
