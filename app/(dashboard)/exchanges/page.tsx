'use client'

import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'
import { Building2, TrendingUp, TrendingDown } from 'lucide-react'
import Link from 'next/link'

type ExchangeStats = {
  exchange_name: string
  total_invested: number
  cash_balance: number
  fees_total: number
  total_value_live: number
  global_live_value: number
  pl_unrealized: number
  pl_realized: number
  pl_total: number
  pl_total_pct: number
  transaction_count: number
  first_transaction_date: string
  last_transaction_date: string
  token_count: number
}

const fmtUsd = (v: number | null, decimals = 2) => {
  if (v == null || !Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  const d = abs < 0.01 ? 6 : abs < 1 ? 4 : decimals
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { 
    minimumFractionDigits: d, 
    maximumFractionDigits: d 
  })
}

const fmtPct = (v: number | null) => {
  if (v == null || !Number.isFinite(v)) return '—'
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'
}

const clsPL = (v: number | null) => {
  if (v == null) return 'text-neutral-400'
  if (v > 0.01) return 'text-emerald-600'
  if (v < -0.01) return 'text-red-600'
  return 'text-neutral-500'
}

export default function ExchangesPage() {
  const [exchanges, setExchanges] = useState<ExchangeStats[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/exchanges/stats')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Errore caricamento')
      setExchanges(json || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  return (
    <div>
      <PageHeader
        title="Exchanges"
        subtitle="Statistiche raggruppate per exchange"
        actions={
          <button
            onClick={load}
            disabled={loading}
            className="rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
          >
            Refresh
          </button>
        }
      />

      {error && (
        <div className="mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <Card>
        <CardBody className="p-0">
          {loading ? (
            <div className="px-4 py-12 text-center text-sm text-neutral-500">
              Caricamento exchanges...
            </div>
          ) : exchanges.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <Building2 className="mx-auto h-12 w-12 text-neutral-300 mb-3" />
              <div className="text-sm text-neutral-500 mb-3">Nessun exchange con transazioni.</div>
              <div className="text-xs text-neutral-400">
                Le statistiche appariranno automaticamente quando aggiungerai transazioni.
              </div>
            </div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full">
                <thead className="bg-neutral-50 border-b border-neutral-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase">
                      Exchange
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase">
                      Transactions
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase">
                      Tokens
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase">
                      Cash Balance
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase">
                      Fees Tot.
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase">
                      Invested
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase">
                      Value Live
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase">
                      Valore Globale Live
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase">
                      P/L Unreal.
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase">
                      P/L Real.
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase">
                      P/L Total
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase">
                      ROI
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {exchanges.map((ex) => (
                    <tr key={ex.exchange_name} className="hover:bg-neutral-50">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-100">
                            <Building2 className="h-5 w-5 text-neutral-600" />
                          </div>
                          <div>
                            <Link
                              href={`/exchanges/${encodeURIComponent(ex.exchange_name)}`}
                              className="font-medium text-sm text-blue-600 hover:text-blue-800 hover:underline"
                            >
                              {ex.exchange_name}
                            </Link>
                            <div className="text-xs text-neutral-500">
                              Dal {new Date(ex.first_transaction_date).toLocaleDateString('it-IT')}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-right text-sm text-neutral-600">
                        {ex.transaction_count}
                      </td>
                      <td className="px-4 py-4 text-right text-sm text-neutral-600">
                        {ex.token_count}
                      </td>
                      <td className="px-4 py-4 text-right text-sm font-medium text-blue-600">
                        {fmtUsd(ex.cash_balance, 0)}
                      </td>
                      <td className="px-4 py-4 text-right text-sm font-medium text-amber-700">
                        {fmtUsd(ex.fees_total, 0)}
                      </td>
                      <td className="px-4 py-4 text-right text-sm font-medium">
                        {fmtUsd(ex.total_invested, 0)}
                      </td>
                      <td className="px-4 py-4 text-right text-sm font-medium">
                        {ex.total_value_live > 0 ? fmtUsd(ex.total_value_live, 0) : '—'}
                      </td>
                      <td className="px-4 py-4 text-right text-sm font-semibold">
                        {fmtUsd(ex.global_live_value, 0)}
                      </td>
                      <td className={`px-4 py-4 text-right text-sm font-medium ${clsPL(ex.pl_unrealized)}`}>
                        {fmtUsd(ex.pl_unrealized, 0)}
                      </td>
                      <td className={`px-4 py-4 text-right text-sm font-medium ${clsPL(ex.pl_realized)}`}>
                        {fmtUsd(ex.pl_realized, 0)}
                      </td>
                      <td className={`px-4 py-4 text-right text-sm font-bold ${clsPL(ex.pl_total)}`}>
                        {fmtUsd(ex.pl_total, 0)}
                      </td>
                      <td className={`px-4 py-4 text-right text-sm font-bold ${clsPL(ex.pl_total_pct)}`}>
                        {fmtPct(ex.pl_total_pct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="mt-4 text-xs text-neutral-400">
        💡 <strong>Info:</strong> Gli exchange vengono aggiunti automaticamente quando inserisci transazioni. 
        Le statistiche mostrano invested, cash balance, P/L unrealized (posizioni aperte) e P/L realized (posizioni chiuse).
      </div>
    </div>
  )
}
