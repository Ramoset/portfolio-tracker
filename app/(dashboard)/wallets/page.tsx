'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'

type Wallet = { id: string; name: string; level: number; parent_wallet_id: string | null }

export default function WalletsPage() {
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      const res = await fetch('/api/wallets')
      const data = await res.json()
      setWallets(data.wallets || [])
      setLoading(false)
    })()
  }, [])

  const subWallets = useMemo(() => wallets.filter(w => !!w.parent_wallet_id), [wallets])


  if (loading) return <div className="text-gray-500">Loading…</div>

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Wallets</h1>

      {subWallets.length === 0 ? (
        <div className="text-gray-500">
          Nessun sotto-wallet trovato. Crea un wallet con parent e level 2.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {subWallets.map(w => (
            <Link
              key={w.id}
              href={`/wallets/${w.id}`}
              className="border rounded-lg p-4 hover:bg-gray-50"
            >
              <div className="font-semibold">{w.name}</div>
              <div className="text-xs text-gray-500 mt-1">Sub-wallet</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
