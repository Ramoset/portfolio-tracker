import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="text-lg font-semibold">
              Portfolio Tracker
            </Link>

            <nav className="flex items-center gap-4 text-sm">
              <Link href="/dashboard" className="hover:underline">
                Dashboard
              </Link>
              <Link href="/transactions" className="hover:underline">
                Transactions
              </Link>
              <Link href="/wallets" className="hover:underline">
                Wallets
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500 hidden sm:inline">
              {user.email}
            </span>

            <form action="/api/auth/logout" method="post">
              <button
                type="submit"
                className="px-3 py-2 text-sm rounded border hover:bg-gray-50"
              >
                Logout
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6">{children}</main>
    </div>
  )
}
