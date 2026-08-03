import { Link, Outlet } from 'react-router-dom'

export function AuthLayout() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-background px-4 py-10">
      <div className="mb-8 flex flex-col items-center gap-3">
        <Link to="/login" className="flex items-center gap-2.5">
          <img src="/pulpo-smiley.png" alt="Pulpo" className="size-10" />
          <span className="text-xl font-semibold tracking-tight">Pulpo</span>
        </Link>
      </div>
      <div className="w-full max-w-[400px]">
        <Outlet />
      </div>
    </div>
  )
}
