'use client'

import { useState, useEffect } from 'react'

interface PortfolioSummary {
  meta: {
    user_id: string
    tx_count: number
    legs_count: number
    limit: number
    include_fee_rows: boolean
    include_unassigned: boolean
    bad_swap_count: number
  }
  balances: Record<string, Record<string, number>>
  totals: Record<string, number>
  negatives: Array<{
    wallet_id: string
    ticker: string
    balance: number
  }>
  warnings: Array<{
    type: string
    tx_id?: string
    message: string
  }>
}

export default function DashboardPage() {
  const [data, setData] = useState<PortfolioSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/portfolio/summary')
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`)
      }
      const json = await res.json()
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <p className="text-gray-500">Loading portfolio data...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
        <p className="text-red-800 font-semibold">Error loading portfolio:</p>
        <p className="text-red-600 text-sm mt-1">{error}</p>
        <button
          onClick={loadData}
          className="mt-3 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!data) {
    return <div>No data</div>
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Portfolio Dashboard</h1>

      {/* Meta Info */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">📊 Summary</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-sm text-gray-500">Transactions</p>
            <p className="text-2xl font-bold">{data.meta.tx_count}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Legs Generated</p>
            <p className="text-2xl font-bold">{data.meta.legs_count}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Assets</p>
            <p className="text-2xl font-bold">{Object.keys(data.totals).length}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Wallets</p>
            <p className="text-2xl font-bold">{Object.keys(data.balances).length}</p>
          </div>
        </div>
      </div>

      {/* Warnings */}
      {data.warnings.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4 text-yellow-800">⚠️ Warnings</h2>
          <ul className="space-y-2">
            {data.warnings.map((w, i) => (
              <li key={i} className="text-sm text-yellow-700">
                <span className="font-semibold">{w.type}:</span> {w.message}
                {w.tx_id && <span className="text-xs ml-2">(tx: {w.tx_id})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Negatives */}
      {data.negatives.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4 text-red-800">❌ Negative Balances</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-red-200">
                  <th className="text-left py-2">Wallet</th>
                  <th className="text-left py-2">Asset</th>
                  <th className="text-right py-2">Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.negatives.map((n, i) => (
                  <tr key={i} className="border-b border-red-100">
                    <td className="py-2 font-mono text-xs">{n.wallet_id}</td>
                    <td className="py-2 font-semibold">{n.ticker}</td>
                    <td className="py-2 text-right font-mono text-red-600">
                      {n.balance.toFixed(8)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Total Balances */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">💰 Total Balances (All Wallets)</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2">Asset</th>
                <th className="text-right py-2">Total Balance</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.totals)
                .sort((a, b) => b[1] - a[1])
                .map(([ticker, balance]) => (
                  <tr key={ticker} className="border-b border-gray-100">
                    <td className="py-2 font-semibold">{ticker}</td>
                    <td className="py-2 text-right font-mono">
                      {balance.toFixed(8)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Balances by Wallet */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">💼 Balances by Wallet</h2>
        <div className="space-y-6">
          {Object.entries(data.balances).map(([walletId, assets]) => (
            <div key={walletId}>
              <h3 className="font-semibold text-lg mb-2 text-gray-700">
                {walletId === 'UNASSIGNED' ? (
                  <span className="text-red-600">⚠️ UNASSIGNED</span>
                ) : (
                  walletId
                )}
              </h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2">Asset</th>
                      <th className="text-right py-2">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(assets)
                      .sort((a, b) => b[1] - a[1])
                      .map(([ticker, balance]) => (
                        <tr key={ticker} className="border-b border-gray-100">
                          <td className="py-2 font-medium">{ticker}</td>
                          <td className="py-2 text-right font-mono">
                            {balance.toFixed(8)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Raw JSON (per debug) */}
      <details className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <summary className="cursor-pointer font-semibold text-gray-700">
          🔍 Raw JSON Data (debug)
        </summary>
        <pre className="mt-4 text-xs overflow-x-auto bg-white p-4 rounded border border-gray-200">
          {JSON.stringify(data, null, 2)}
        </pre>
      </details>
    </div>
  )
}
