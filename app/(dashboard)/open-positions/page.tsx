'use client'

import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'

type Lot = {
  lot_id: string
  date: string
  exchange: string | null
  qty_original: number
  qty_remaining: number
  total_cost_notional: number
  cost_per_unit_margin: number
  total_cost_margin: number
  leverage: number | null
  source: 'BUY' | 'SWAP' | 'AIRDROP' | 'DEPOSIT'
}

type Position = {
  wallet_id: string
  wallet_name: string
  exchange: string | null
  accounting_method: 'LIFO' | 'FIFO' | 'AVG'
  ticker: string
  direction: 'LONG' | 'SHORT'
  qty_total: number
  avg_cost: number
  total_cost: number
  price_live: number | null
  value_live: number | null
  pl_unrealized: number | null
  pl_pct: number | null
  leverage: number | null
  lots: Lot[]
}

const fmtUsd = (v: number | null, decimals = 2) => {
  if (v == null) return '—'
  const abs = Math.abs(v)
  const d = abs < 0.01 ? 6 : abs < 1 ? 4 : decimals
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

const fmtQty = (v: number) => {
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (v >= 1) return v.toLocaleString('en-US', { maximumFractionDigits: 4 })
  return v.toLocaleString('en-US', { maximumFractionDigits: 8 })
}

const fmtPct = (v: number | null) => {
  if (v == null) return '—'
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'
}

const fmtDate = (d: string) => {
  const dt = new Date(d)
  return dt.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

const clsPL = (v: number | null) => {
  if (v == null) return 'text-neutral-400'
  if (v > 0) return 'text-emerald-600'
  if (v < 0) return 'text-red-600'
  return 'text-neutral-500'
}

const methodBadge: Record<string, string> = {
  LIFO: 'bg-purple-100 text-purple-700',
  FIFO: 'bg-blue-100 text-blue-700',
  AVG: 'bg-neutral-100 text-neutral-600',
}

const sourceBadge: Record<string, string> = {
  BUY: 'bg-emerald-100 text-emerald-700',
  SWAP: 'bg-blue-100 text-blue-700',
  AIRDROP: 'bg-amber-100 text-amber-700',
  DEPOSIT: 'bg-neutral-100 text-neutral-600',
}

function PositionRowWrapper({ pos, forceOpen }: { pos: Position; forceOpen: boolean }) {
  const [open, setOpen] = useState(false)
  const isOpen = forceOpen || open
  const exchangeLabel = pos.exchange || '—'

  return (
    <>
      <tr className="cursor-pointer hover:bg-neutral-50 border-b border-neutral-100" onClick={() => setOpen((o) => !o)}>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-neutral-400 text-xs w-3">{isOpen ? '▼' : '▶'}</span>
            <span className="font-mono font-bold text-neutral-900">{pos.ticker}</span>
          </div>
        </td>

        <td className="px-4 py-3 text-center">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              pos.direction === 'SHORT' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'
            }`}
          >
            {pos.direction}
          </span>
        </td>

        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-neutral-700">{pos.wallet_name}</span>
            <span className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${methodBadge[pos.accounting_method]}`}>{pos.accounting_method}</span>
          </div>
        </td>
        <td className="px-4 py-3 text-sm text-neutral-700">{exchangeLabel}</td>

        <td className="px-4 py-3 text-right font-mono text-sm">{fmtQty(pos.qty_total)}</td>
        <td className="px-4 py-3 text-right text-sm text-neutral-600">{fmtUsd(pos.avg_cost, 4)}</td>
        <td className="px-4 py-3 text-right text-sm font-medium">
          {pos.leverage && pos.leverage > 1 ? <span className="text-indigo-700">x{pos.leverage}</span> : <span className="text-neutral-400">—</span>}
        </td>
        <td className="px-4 py-3 text-right text-sm font-medium">{fmtUsd(pos.total_cost)}</td>
        <td className="px-4 py-3 text-right text-sm">
          {pos.price_live != null ? <span className="font-medium text-neutral-900">{fmtUsd(pos.price_live, 4)}</span> : <span className="text-neutral-400">—</span>}
        </td>
        <td className="px-4 py-3 text-right text-sm font-medium">{pos.value_live != null ? fmtUsd(pos.value_live) : <span className="text-neutral-400">—</span>}</td>
        <td className="px-4 py-3 text-right"><span className={`text-sm font-medium ${clsPL(pos.pl_unrealized)}`}>{fmtUsd(pos.pl_unrealized)}</span></td>
        <td className="px-4 py-3 text-right"><span className={`text-sm font-medium ${clsPL(pos.pl_pct)}`}>{fmtPct(pos.pl_pct)}</span></td>
        <td className="px-4 py-3 text-right text-xs text-neutral-500">{pos.lots.length} {pos.lots.length === 1 ? 'lotto' : 'lotti'}</td>
      </tr>

      {isOpen &&
        pos.lots.map((lot, i) => {
          const lotPl =
            pos.price_live == null
              ? null
              : (pos.direction === 'SHORT'
                ? (lot.total_cost_notional - lot.qty_remaining * pos.price_live)
                : (lot.qty_remaining * pos.price_live - lot.total_cost_notional))
          const lotPlPct =
            lotPl != null && lot.total_cost_margin > 0
              ? (lotPl / lot.total_cost_margin) * 100
              : null

          return (
          <tr key={`${lot.lot_id}-${i}`} className="bg-neutral-50/80 border-b border-neutral-100">
            <td className="px-4 py-2 pl-10"><span className="text-xs text-neutral-400">#{i + 1}</span></td>
            <td className="px-4 py-2 text-center">
              {lot.leverage && lot.leverage > 1 ? <span className="text-indigo-700 text-xs font-medium">x{lot.leverage}</span> : <span className="text-xs text-neutral-400">—</span>}
            </td>
            <td className="px-4 py-2">
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${sourceBadge[lot.source] || 'bg-neutral-100 text-neutral-600'}`}>{lot.source}</span>
                <span className="text-xs text-neutral-500">{fmtDate(lot.date)}</span>
              </div>
            </td>
            <td className="px-4 py-2 text-xs text-neutral-600">{lot.exchange || pos.exchange || '—'}</td>
            <td className="px-4 py-2 text-right">
              <div className="text-xs">
                <span className="font-mono text-neutral-700">{fmtQty(lot.qty_remaining)}</span>
                {lot.qty_remaining < lot.qty_original - 1e-9 && <span className="text-neutral-400 ml-1">/ {fmtQty(lot.qty_original)}</span>}
              </div>
            </td>
            <td className="px-4 py-2 text-right text-xs text-neutral-600 font-mono">{lot.cost_per_unit_margin > 0 ? fmtUsd(lot.cost_per_unit_margin, 4) : <span className="text-neutral-400">—</span>}</td>
            <td className="px-4 py-2 text-right text-xs text-neutral-400">—</td>
            <td className="px-4 py-2 text-right text-xs text-neutral-600 font-mono">{lot.total_cost_margin > 0 ? fmtUsd(lot.total_cost_margin) : <span className="text-neutral-400">—</span>}</td>
            <td className="px-4 py-2 text-right text-xs font-medium">{pos.price_live != null ? fmtUsd(pos.price_live, 4) : <span className="text-neutral-400">—</span>}</td>
            <td className="px-4 py-2 text-right text-xs font-medium">{pos.price_live != null ? fmtUsd(lot.total_cost_margin + (lotPl || 0)) : <span className="text-neutral-400">—</span>}</td>
            <td className={`px-4 py-2 text-right text-xs font-semibold ${clsPL(lotPl)}`}>{fmtUsd(lotPl)}</td>
            <td className={`px-4 py-2 text-right text-xs font-semibold ${clsPL(lotPlPct)}`}>{fmtPct(lotPlPct)}</td>
            <td className="px-4 py-2 text-right text-xs text-neutral-400">—</td>
          </tr>
          )
        })}
    </>
  )
}

export default function OpenPositionsPage() {
  const [positions, setPositions] = useState<Position[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [filterDirection, setFilterDirection] = useState<'ALL' | 'LONG' | 'SHORT'>('ALL')
  const [filterLeverage, setFilterLeverage] = useState<'ALL' | 'SPOT' | 'LEVERAGED'>('ALL')
  const [walletFilter, setWalletFilter] = useState('ALL')
  const [expandAll, setExpandAll] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/open-positions')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Errore caricamento')
      setPositions(json.positions || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const wallets = useMemo(() => [...new Set(positions.map((p) => p.wallet_name))].sort(), [positions])

  const filtered = useMemo(() => {
    let list = [...positions]

    if (search.trim()) {
      const s = search.trim().toLowerCase()
      list = list.filter((p) =>
        p.ticker.toLowerCase().includes(s) ||
        p.wallet_name.toLowerCase().includes(s) ||
        String(p.exchange || '').toLowerCase().includes(s)
      )
    }

    if (filterDirection !== 'ALL') list = list.filter((p) => p.direction === filterDirection)

    if (filterLeverage === 'SPOT') list = list.filter((p) => !p.leverage || p.leverage <= 1)
    if (filterLeverage === 'LEVERAGED') list = list.filter((p) => !!p.leverage && p.leverage > 1)

    if (walletFilter !== 'ALL') list = list.filter((p) => p.wallet_name === walletFilter)

    return list
  }, [positions, search, filterDirection, filterLeverage, walletFilter])

  const kpis = useMemo(() => {
    const totalCost = filtered.reduce((s, p) => s + p.total_cost, 0)
    const totalValue = filtered.filter((p) => p.value_live != null).reduce((s, p) => s + (p.value_live ?? 0), 0)
    const totalPL = filtered.filter((p) => p.pl_unrealized != null).reduce((s, p) => s + (p.pl_unrealized ?? 0), 0)
    const totalPLPct = totalCost > 0 ? (totalPL / totalCost) * 100 : null
    const posCount = filtered.length
    const lotCount = filtered.reduce((s, p) => s + p.lots.length, 0)
    return { totalCost, totalValue, totalPL, totalPLPct, posCount, lotCount }
  }, [filtered])

  const trendData = useMemo(() => {
    const perDay = new Map<string, { invested: number; valueLive: number }>()

    for (const pos of filtered) {
      const safeQtyTotal = pos.qty_total > 0 ? pos.qty_total : 0
      const unitLive =
        safeQtyTotal > 0
          ? (pos.value_live ?? pos.total_cost) / safeQtyTotal
          : 0

      for (const lot of pos.lots) {
        const day = new Date(lot.date).toISOString().slice(0, 10)
        const invested = lot.total_cost_margin
        const liveEq = unitLive * lot.qty_remaining
        const prev = perDay.get(day) || { invested: 0, valueLive: 0 }
        perDay.set(day, {
          invested: prev.invested + invested,
          valueLive: prev.valueLive + liveEq,
        })
      }
    }

    const sortedDays = Array.from(perDay.keys()).sort()
    let cumInvested = 0
    let cumValueLive = 0

    return sortedDays.map((day) => {
      const curr = perDay.get(day)!
      cumInvested += curr.invested
      cumValueLive += curr.valueLive
      return {
        day,
        label: new Date(day).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }),
        invested: cumInvested,
        valueLive: cumValueLive,
      }
    })
  }, [filtered])

  return (
    <div>
      <PageHeader
        title="Posizioni Aperte"
        subtitle="Lotti aperti per wallet, exchange e ticker"
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

      {error && <div className="mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="mb-4 grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Posizioni', value: kpis.posCount.toString(), sub: `${kpis.lotCount} lotti` },
          { label: 'Investito', value: fmtUsd(kpis.totalCost, 0), sub: 'costo base open' },
          { label: 'Valore Live', value: kpis.totalValue > 0 ? fmtUsd(kpis.totalValue, 0) : '—', sub: '' },
          { label: 'P/L Non Real.', value: fmtUsd(kpis.totalPL), sub: 'posizioni aperte', color: clsPL(kpis.totalPL) },
          { label: 'P/L %', value: fmtPct(kpis.totalPLPct), sub: '', color: clsPL(kpis.totalPLPct) },
        ].map((k, i) => (
          <Card key={i}>
            <CardBody className="py-3">
              <div className="text-xs text-neutral-500 uppercase">{k.label}</div>
              <div className={`text-lg font-semibold mt-0.5 ${k.color || 'text-neutral-900'}`}>{k.value}</div>
              {k.sub && <div className={`text-xs ${k.color || 'text-neutral-400'}`}>{k.sub}</div>}
            </CardBody>
          </Card>
        ))}
      </div>

      <Card className="mb-4">
        <CardBody className="py-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-neutral-900">Andamento Posizioni Aperte</div>
              <div className="text-xs text-neutral-500">Cumulato su lotti aperti filtrati</div>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="inline-flex items-center gap-1.5 text-neutral-600">
                <span className="h-2.5 w-2.5 rounded-full bg-slate-500" />
                Investito
              </span>
              <span className="inline-flex items-center gap-1.5 text-neutral-600">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                Valore live
              </span>
            </div>
          </div>

          {trendData.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-sm text-neutral-400">
              Nessun dato da mostrare con i filtri attuali.
            </div>
          ) : (
            <div className="h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="openInvested" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#64748b" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#64748b" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="openLive" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#6b7280' }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
                  />
                  <Tooltip
                    formatter={(v: any) => fmtUsd(Number(v), 0)}
                    labelFormatter={(label) => `Data: ${label}`}
                    contentStyle={{ borderRadius: 10, borderColor: '#e5e7eb' }}
                  />
                  <Area type="monotone" dataKey="invested" stroke="#475569" fill="url(#openInvested)" strokeWidth={2} />
                  <Area type="monotone" dataKey="valueLive" stroke="#10b981" fill="url(#openLive)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-neutral-100">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca ticker, wallet o exchange..."
            className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-sm w-52 focus:outline-none focus:border-slate-400"
          />

          <div className="flex rounded-lg border border-neutral-200 overflow-hidden text-xs font-medium">
            {(['ALL', 'LONG', 'SHORT'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setFilterDirection(v)}
                className={`px-2.5 py-1.5 ${filterDirection === v ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-600 hover:bg-neutral-50'}`}
              >
                {v}
              </button>
            ))}
          </div>

          <div className="flex rounded-lg border border-neutral-200 overflow-hidden text-xs font-medium">
            {(['ALL', 'SPOT', 'LEVERAGED'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setFilterLeverage(v)}
                className={`px-2.5 py-1.5 ${filterLeverage === v ? 'bg-slate-700 text-white' : 'bg-white text-neutral-600 hover:bg-neutral-50'}`}
              >
                {v === 'ALL' ? 'Tutti' : v === 'LEVERAGED' ? 'Leva' : 'Spot'}
              </button>
            ))}
          </div>

          <select
            value={walletFilter}
            onChange={(e) => setWalletFilter(e.target.value)}
            className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm"
          >
            <option value="ALL">Tutti i wallet</option>
            {wallets.map((w) => (
              <option key={w} value={w}>{w}</option>
            ))}
          </select>

          <button
            onClick={() => setExpandAll((v) => !v)}
            className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            {expandAll ? 'Comprimi tutti' : 'Espandi tutti'}
          </button>

          <button
            onClick={() => {
              setSearch('')
              setFilterDirection('ALL')
              setFilterLeverage('ALL')
              setWalletFilter('ALL')
            }}
            className="ml-auto rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50"
          >
            Clear
          </button>
        </div>

        <CardBody className="p-0">
          {loading ? (
            <div className="px-4 py-8 text-center text-sm text-neutral-500">Caricamento…</div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-neutral-500">
              {positions.length === 0 ? 'Nessuna posizione aperta.' : 'Nessun risultato con i filtri attuali.'}
            </div>
          ) : (
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-neutral-50 border-b border-neutral-200">
                  <tr>
                    {['Ticker', 'Direction', 'Wallet', 'Exchange', 'Qty', 'Avg Cost', 'Leva', 'Investito', 'Prezzo Live', 'Valore Live', 'P/L $', 'P/L %', 'Lotti'].map((h) => (
                      <th
                        key={h}
                        className={`px-4 py-3 text-xs font-medium uppercase text-neutral-500 ${['Direction'].includes(h) ? 'text-center' : ['Qty', 'Avg Cost', 'Leva', 'Investito', 'Prezzo Live', 'Valore Live', 'P/L $', 'P/L %', 'Lotti'].includes(h) ? 'text-right' : 'text-left'}`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((pos) => (
                    <PositionRowWrapper key={`${pos.wallet_id}-${pos.exchange || 'NA'}-${pos.ticker}-${pos.direction}`} pos={pos} forceOpen={expandAll} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="mt-3 text-xs text-neutral-400">
        Prezzi live aggiornati ogni 60s. Il metodo contabile (LIFO/FIFO/AVG) si configura nelle Settings per ogni wallet.
      </div>
    </div>
  )
}
