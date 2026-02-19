'use client'

import { Search, PanelLeft, LogOut, RefreshCw } from 'lucide-react'
import { usePrices } from '@/contexts/PricesContext'

export function Topbar({
  onToggleSidebar,
  userEmail,
}: {
  onToggleSidebar: () => void
  userEmail?: string | null
}) {
  const { isRefreshing, refreshPrices } = usePrices()

  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white px-3 py-2 shadow-sm">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="grid h-9 w-9 place-items-center rounded-xl hover:bg-neutral-100"
          aria-label="Toggle sidebar"
        >
          <PanelLeft className="h-5 w-5" />
        </button>

        <div className="text-sm font-semibold">Portfolio Tracker</div>
      </div>

      <div className="flex w-full max-w-md items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">
        <Search className="h-4 w-4 text-neutral-500" />
        <input
          className="w-full bg-transparent text-sm outline-none placeholder:text-neutral-500"
          placeholder="Cerca ticker, wallet, note…"
        />
      </div>

      <div className="flex items-center gap-2">
        {userEmail ? (
          <span className="hidden sm:inline text-xs text-neutral-500">
            {userEmail}
          </span>
        ) : null}

        <button
          type="button"
          onClick={refreshPrices}
          disabled={isRefreshing}
          className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
          title="Aggiorna prezzi live"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Refresh</span>
        </button>

        <form action="/api/auth/logout" method="post">
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm hover:bg-neutral-50"
            title="Logout"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </form>
      </div>
    </div>
  )
}
