'use client'

import { useState } from 'react'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { PricesProvider } from '@/contexts/PricesContext'

export function Shell({
  children,
  userEmail,
}: {
  children: React.ReactNode
  userEmail?: string | null
}) {
  const [sidebarOpen, setSidebarOpen] = useState(true)

  return (
    <PricesProvider>
      <div className="min-h-screen bg-neutral-50 text-neutral-900">
        <div className="mx-auto flex max-w-[1400px] gap-4 px-3 py-3">
          <Sidebar open={sidebarOpen} onToggle={() => setSidebarOpen((v) => !v)} />

          <main className="min-w-0 flex-1">
            <Topbar
              onToggleSidebar={() => setSidebarOpen((v) => !v)}
              userEmail={userEmail}
            />
            <div className="mt-3 rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm">
              {children}
            </div>
          </main>
        </div>
      </div>
    </PricesProvider>
  )
}
