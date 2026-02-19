'use client'

import { useEffect, useMemo, useState } from 'react'

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number.isFinite(n) ? n : 0)
}

type PositionRow = {
  ticker: string
  qty_open: number
  avg_cost: number | null
  invested_open: number
  pl_realized: number
}

export default function WalletDetailPage({ params }: { params: { id: string } }) {
  const walletId = params.id

  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<any>(null)

  const [editTarget, setEditTarget] = useState<string>('0')
  const [savingTarget, setSavingTarget] = useState(false)

  const load = async () => {
    setLoading(true)

    const res = await fetch(`/api/wallets/${walletId}/accounting-summary`)
    const json = await res.json()

    setData(json)

    // target% arriva già dentro settings
    setEditTarget(String(json?.settings?.target_pct ?? 0))

    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletId])

  const positions: PositionRow[] = useMemo(() => data?.positions || [], [data])

  const saveTarget = async () => {
    const v = Number(editTarget)
    if (!Number.isFinite(v) || v < 0 || v > 100) return alert('target% non valido (0-100)')

    setSavingTarget(true)
    try {
      const res = await fetch(`/api/wallet-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_id: walletId, target_pct: v }),
      })

      const j = await res.json().catch(() => ({}))
      if (!res.ok) return alert(j?.error || 'Errore salvataggio')

      // aggiorna UI subito e ricarica i calcoli
      setEditTarget(String(j?.target_pct ?? v))
      await load()
    } finally {
      setSavingTarget(false)
    }
  }

  if (loading) return <div className="text-gray-500">Loading…</div>
  if (data?.error) return <div className="text-red-600">Error: {data.error}</div>

  const rootDeposits = Number(data?.root?.deposits ?? 0)

  const budget = Number(data?.summary?.budget ?? 0)
  const investedOpen = Number(data?.summary?.invested_open ?? 0)
  const plRealized = Number(data?.summary?.pl_realized ?? 0)
  const cash = Number(data?.summary?.cash ?? 0)

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold">{data.wallet?.name}</h1>
          <div className="text-xs text-gray-500 mt-1">
            Root: {data.root?.id ? '•' : ''} Deposits(root): {fmt(rootDeposits)}
          </div>
        </div>

        <div className="border rounded-lg p-3 w-full max-w-sm">
          <div className="text-sm font-semibold mb-2">Wallet Settings</div>
          <div className="flex items-center gap-2">
            <div className="text-xs text-gray-600 w-32">Target % (of root)</div>
            <input
              value={editTarget}
              onChange={(e) => setEditTarget(e.target.value)}
              className="border rounded px-2 py-1 text-sm w-24"
              inputMode="decimal"
            />
            <button
              onClick={saveTarget}
              disabled={savingTarget}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {savingTarget ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      {/* Summary boxes */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="border rounded-lg p-4">
          <div className="text-xs text-gray-500">Budget (allocazione $)</div>
          <div className="text-xl font-semibold">{fmt(budget)}</div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-xs text-gray-500">Investito (open cost)</div>
          <div className="text-xl font-semibold">{fmt(investedOpen)}</div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-xs text-gray-500">P/L Realizzato</div>
          <div className={`text-xl font-semibold ${plRealized >= 0 ? 'text-green-700' : 'text-red-700'}`}>
            {fmt(plRealized)}
          </div>
        </div>
        <div className="border rounded-lg p-4">
          <div className="text-xs text-gray-500">Cash (contabile)</div>
          <div className="text-xl font-semibold">{fmt(cash)}</div>
        </div>
      </div>

      {/* Positions table */}
      <div className="bg-white shadow rounded-lg overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ticker</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Qty Open</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Avg Cost</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Invested (open)</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">P/L Realized</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {positions.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-center text-gray-500" colSpan={5}>
                  Nessuna posizione contabile trovata (BUY/SELL in stable).
                </td>
              </tr>
            ) : (
              positions.map((p) => (
                <tr key={p.ticker} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-semibold">{p.ticker}</td>
                  <td className="px-4 py-3 text-right">{Number(p.qty_open || 0).toFixed(8)}</td>
                  <td className="px-4 py-3 text-right">{p.avg_cost ? Number(p.avg_cost).toFixed(8) : '-'}</td>
                  <td className="px-4 py-3 text-right">{fmt(Number(p.invested_open || 0))}</td>
                  <td className={`px-4 py-3 text-right ${Number(p.pl_realized || 0) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {fmt(Number(p.pl_realized || 0))}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-gray-500 mt-4">
        MVP contabile: cost basis = AVG, P/L live e value live verranno aggiunti quando colleghiamo prezzi real-time (con cache).
      </div>
    </div>
  )
}

