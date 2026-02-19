'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'

type Position = {
  position_key: string
  ticker: string
  position_type: 'SPOT' | 'LEVERAGE'
  leverage: number | null
  qty_open: number
  avg_cost: number
  invested_open: number
  price_live: number | null
  value_live: number | null
  weight_invested_pct: number
  weight_live_pct: number
  pl_realized: number
  pl_unrealized: number | null
  pl_total: number | null
}

type ExchangeMovement = {
  id: string
  date: string
  action: string
  ticker: string
  wallet_id: string | null
  wallet_name: string | null
  quantity: number
  price: number
  price_currency: string
  fees: number
  fees_currency: string
  notes: string | null
}

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
  positions: Position[]
  movements: ExchangeMovement[]
}

const fmtUsd = (v: number | null, decimals = 2) => {
  if (v == null || !Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  const d = abs < 0.01 ? 6 : abs < 1 ? 4 : decimals
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  })
}

const fmtPct = (v: number | null) => {
  if (v == null || !Number.isFinite(v)) return '—'
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'
}

const fmtQty = (v: number | null, max = 8) => {
  if (v == null || !Number.isFinite(v)) return '—'
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: max })
}

const fmtDate = (v: string) => {
  const d = new Date(v)
  if (!Number.isFinite(d.getTime())) return v
  return d.toLocaleString('it-IT')
}

const clsPL = (v: number | null) => {
  if (v == null) return 'text-neutral-400'
  if (v > 0.01) return 'text-emerald-600'
  if (v < -0.01) return 'text-red-600'
  return 'text-neutral-500'
}

export default function ExchangeDetailPage({ params }: { params: { exchange: string } }) {
  const exchangeName = decodeURIComponent(params.exchange || '')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<ExchangeStats | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/exchanges/stats?exchange=${encodeURIComponent(exchangeName)}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Errore caricamento exchange')
      setData(json)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [exchangeName])

  const positions = useMemo(() => data?.positions || [], [data])
  const movements = useMemo(() => data?.movements || [], [data])

  return (
    <div>
      <PageHeader
        title={data?.exchange_name || exchangeName}
        subtitle="Dettaglio token per exchange"
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/exchanges"
              className="rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-sm hover:bg-neutral-50"
            >
              ← Back
            </Link>
            <button
              onClick={load}
              disabled={loading}
              className="rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
        }
      />

      {error && (
        <div className="mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {data && (
        <div className="mb-4 grid grid-cols-2 lg:grid-cols-8 gap-3">
          <Card><CardBody className="p-4"><div className="text-xs text-neutral-500">Transactions</div><div className="text-xl font-semibold">{data.transaction_count}</div></CardBody></Card>
          <Card><CardBody className="p-4"><div className="text-xs text-neutral-500">Tokens Open</div><div className="text-xl font-semibold">{data.token_count}</div></CardBody></Card>
          <Card><CardBody className="p-4"><div className="text-xs text-neutral-500">Cash Balance</div><div className="text-xl font-semibold text-blue-600">{fmtUsd(data.cash_balance, 0)}</div></CardBody></Card>
          <Card><CardBody className="p-4"><div className="text-xs text-neutral-500">Fees Totali</div><div className="text-xl font-semibold text-amber-600">{fmtUsd(data.fees_total, 0)}</div></CardBody></Card>
          <Card><CardBody className="p-4"><div className="text-xs text-neutral-500">Valore Globale Live</div><div className="text-xl font-semibold">{fmtUsd(data.global_live_value, 0)}</div></CardBody></Card>
          <Card><CardBody className="p-4"><div className="text-xs text-neutral-500">P/L Unrealized</div><div className={`text-xl font-semibold ${clsPL(data.pl_unrealized)}`}>{fmtUsd(data.pl_unrealized, 0)}</div></CardBody></Card>
          <Card><CardBody className="p-4"><div className="text-xs text-neutral-500">P/L Realized</div><div className={`text-xl font-semibold ${clsPL(data.pl_realized)}`}>{fmtUsd(data.pl_realized, 0)}</div></CardBody></Card>
          <Card><CardBody className="p-4"><div className="text-xs text-neutral-500">P/L Total</div><div className={`text-xl font-semibold ${clsPL(data.pl_total)}`}>{fmtUsd(data.pl_total, 0)} <span className="text-sm">{fmtPct(data.pl_total_pct)}</span></div></CardBody></Card>
        </div>
      )}

      <Card>
        <CardBody className="p-0">
          {loading ? (
            <div className="px-4 py-12 text-center text-sm text-neutral-500">Caricamento dettaglio exchange...</div>
          ) : positions.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-neutral-500">Nessun token aperto su questo exchange.</div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full">
                <thead className="bg-neutral-50 border-b border-neutral-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase">Ticker</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase">Tipo</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase">Leva</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase">Qty Open</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase">Avg Cost</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase">Invested</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase">Token Space</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase">Price Live</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase">Value Live</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase">P/L Realized</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase">P/L Unrealized</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase">P/L Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {positions.map((p) => (
                    <tr key={p.position_key} className="hover:bg-neutral-50">
                      <td className="px-4 py-3 text-sm font-medium">{p.ticker}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          p.position_type === 'LEVERAGE'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-sky-100 text-sky-700'
                        }`}>
                          {p.position_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-medium">
                        {p.position_type === 'LEVERAGE' && p.leverage ? `x${p.leverage}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-sm">{fmtQty(p.qty_open)}</td>
                      <td className="px-4 py-3 text-right text-sm">{fmtUsd(p.avg_cost, 6)}</td>
                      <td className="px-4 py-3 text-right text-sm">{fmtUsd(p.invested_open, 2)}</td>
                      <td className="px-4 py-3 text-right text-sm">{fmtPct(p.weight_live_pct)} <span className="text-xs text-neutral-500">live incl. cash</span></td>
                      <td className="px-4 py-3 text-right text-sm">{p.price_live == null ? '—' : fmtUsd(p.price_live, 6)}</td>
                      <td className="px-4 py-3 text-right text-sm">{fmtUsd(p.value_live, 2)}</td>
                      <td className={`px-4 py-3 text-right text-sm font-medium ${clsPL(p.pl_realized)}`}>{fmtUsd(p.pl_realized, 2)}</td>
                      <td className={`px-4 py-3 text-right text-sm font-medium ${clsPL(p.pl_unrealized)}`}>{fmtUsd(p.pl_unrealized, 2)}</td>
                      <td className={`px-4 py-3 text-right text-sm font-semibold ${clsPL(p.pl_total)}`}>{fmtUsd(p.pl_total, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Card className="mt-4">
        <CardBody className="p-0">
          <div className="px-4 py-3 border-b border-neutral-200 text-sm font-semibold">
            Movimenti Exchange (ultimi {movements.length})
          </div>
          {loading ? (
            <div className="px-4 py-8 text-center text-sm text-neutral-500">Caricamento movimenti...</div>
          ) : movements.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-neutral-500">Nessun movimento trovato per questo exchange.</div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full">
                <thead className="bg-neutral-50 border-b border-neutral-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase">Action</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase">Ticker</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase">Wallet</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase">Qty</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase">Price</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase">Fees</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {movements.map((m) => (
                    <tr key={m.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-2 text-sm whitespace-nowrap">{fmtDate(m.date)}</td>
                      <td className="px-4 py-2 text-sm">{m.action}</td>
                      <td className="px-4 py-2 text-sm font-medium">{m.ticker}</td>
                      <td className="px-4 py-2 text-sm">{m.wallet_name || '—'}</td>
                      <td className="px-4 py-2 text-right text-sm">{fmtQty(m.quantity)}</td>
                      <td className="px-4 py-2 text-right text-sm">{m.price > 0 ? `${fmtUsd(m.price, 6)} ${m.price_currency || ''}`.trim() : '—'}</td>
                      <td className="px-4 py-2 text-right text-sm">{m.fees > 0 ? `${fmtQty(m.fees, 10)} ${m.fees_currency || ''}`.trim() : '—'}</td>
                      <td className="px-4 py-2 text-sm text-neutral-600">{m.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
