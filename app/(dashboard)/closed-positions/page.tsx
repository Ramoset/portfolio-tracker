'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'

const FONT_STYLE = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,300&family=DM+Mono:wght@400;500&display=swap');
  .cp-page * { font-family: 'DM Sans', sans-serif; }
  .cp-page .mono { font-family: 'DM Mono', monospace; }
`

// ─── helpers ─────────────────────────────────────────────────────────────────
function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number.isFinite(n) ? n : 0)
}
function fmtQty(n: number) {
  if (!Number.isFinite(n)) return '—'
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (n >= 1) return n.toFixed(4)
  return n.toFixed(8)
}
function fmtPct(n: number) {
  if (!Number.isFinite(n)) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}
function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' })
}
function clsPL(v: number) {
  if (v > 0.001) return 'text-emerald-600'
  if (v < -0.001) return 'text-red-500'
  return 'text-neutral-500'
}

// ─── column definitions ───────────────────────────────────────────────────────
type ColDef = { key: string; label: string; defaultVisible: boolean; align: 'left' | 'right' | 'center' }

const ALL_COLS: ColDef[] = [
  { key: 'date_close',    label: 'Data Chiusura',  defaultVisible: true,  align: 'left'   },
  { key: 'date_open',     label: 'Data Apertura',  defaultVisible: true,  align: 'left'   },
  { key: 'holding_days',  label: 'Giorni',         defaultVisible: true,  align: 'right'  },
  { key: 'ticker',        label: 'Ticker',         defaultVisible: true,  align: 'left'   },
  { key: 'direction',     label: 'Direction',      defaultVisible: true,  align: 'center' },
  { key: 'action',        label: 'Tipo',           defaultVisible: false, align: 'center' },
  { key: 'wallet_name',   label: 'Wallet',         defaultVisible: true,  align: 'left'   },
  { key: 'qty_sold',      label: 'Qty Venduta',    defaultVisible: true,  align: 'right'  },
  { key: 'entry_price',   label: 'Entry (avg)',    defaultVisible: true,  align: 'right'  },
  { key: 'exit_price',    label: 'Exit',           defaultVisible: true,  align: 'right'  },
  { key: 'invested_cost', label: 'Investito',      defaultVisible: true,  align: 'right'  },
  { key: 'proceeds',      label: 'Ricavato',       defaultVisible: true,  align: 'right'  },
  { key: 'fees_sell',     label: 'Fee',            defaultVisible: true,  align: 'right'  },
  { key: 'pl_usd',        label: 'P/L $',          defaultVisible: true,  align: 'right'  },
  { key: 'pl_pct',        label: 'P/L %',          defaultVisible: true,  align: 'right'  },
  { key: 'qty_remaining', label: 'Qty Restante',   defaultVisible: true,  align: 'right'  },
  { key: 'status',        label: 'Status',         defaultVisible: true,  align: 'center' },
  { key: 'leverage',      label: 'Leva',           defaultVisible: true,  align: 'right'  },
  { key: 'notes',         label: 'Note / Strategia', defaultVisible: false, align: 'left' },
]

// ─── types ───────────────────────────────────────────────────────────────────
type Position = {
  id: string; ticker: string; wallet_id: string; wallet_name: string | null
  direction: string; action: string; qty_sold: number; entry_price: number
  exit_price: number; invested_cost: number; proceeds: number; fees_sell: number
  pl_usd: number; pl_pct: number; date_open: string | null; date_close: string
  holding_days: number | null; qty_remaining: number; status: 'CLOSED' | 'PARTIAL'
  notes: string | null; leverage: number | null; exchange: string | null
}

// ─── gear panel ──────────────────────────────────────────────────────────────
function ColPanel({ visible, colVis, onChange, onClose }: {
  visible: boolean; colVis: Record<string, boolean>
  onChange: (k: string, v: boolean) => void; onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!visible) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [visible, onClose])
  if (!visible) return null
  return (
    <div ref={ref} className="absolute right-0 top-10 z-50 w-64 rounded-2xl border border-neutral-200 bg-white/95 shadow-2xl p-4" style={{ backdropFilter: 'blur(12px)' }}>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-neutral-700">Colonne visibili</span>
        <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600 text-lg leading-none">×</button>
      </div>
      <div className="space-y-1 max-h-80 overflow-y-auto">
        {ALL_COLS.map(col => (
          <label key={col.key} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-neutral-50">
            <input type="checkbox" checked={colVis[col.key] ?? true} onChange={e => onChange(col.key, e.target.checked)} className="h-3.5 w-3.5 rounded accent-slate-600" />
            <span className="text-xs text-neutral-600">{col.label}</span>
          </label>
        ))}
      </div>
      <div className="mt-3 border-t border-neutral-100 pt-3">
        <button onClick={() => ALL_COLS.forEach(c => onChange(c.key, c.defaultVisible))} className="text-xs text-neutral-400 hover:text-neutral-600 underline">Ripristina default</button>
      </div>
    </div>
  )
}

// ─── main ─────────────────────────────────────────────────────────────────────
export default function ClosedPositionsPage() {
  const [loading, setLoading] = useState(true)
  const [positions, setPositions] = useState<Position[]>([])
  const [error, setError] = useState<string | null>(null)

  // filters
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'CLOSED' | 'PARTIAL'>('ALL')
  const [filterDirection, setFilterDirection] = useState<'ALL' | 'LONG' | 'SHORT'>('ALL')
  const [filterWallet, setFilterWallet] = useState('ALL')

  // sort
  const [sortKey, setSortKey] = useState<string>('date_close')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // columns
  const [showColPanel, setShowColPanel] = useState(false)
  const [colVis, setColVis] = useState<Record<string, boolean>>(
    () => ALL_COLS.reduce((a, c) => ({ ...a, [c.key]: c.defaultVisible }), {})
  )

  useEffect(() => {
    fetch('/api/closed-positions')
      .then(r => r.json())
      .then(j => { if (j.error) setError(j.error); else { setPositions(j.positions) } })
      .catch(() => setError('Errore di rete'))
      .finally(() => setLoading(false))
  }, [])

  const wallets = useMemo(() => {
    const set = new Set(positions.map(p => p.wallet_name).filter(Boolean) as string[])
    return Array.from(set).sort()
  }, [positions])

  const filtered = useMemo(() => {
    let list = [...positions]
    if (search) {
      const s = search.toLowerCase()
      list = list.filter(p => p.ticker.toLowerCase().includes(s) || (p.wallet_name || '').toLowerCase().includes(s) || (p.notes || '').toLowerCase().includes(s))
    }
    if (filterStatus !== 'ALL') list = list.filter(p => p.status === filterStatus)
    if (filterDirection !== 'ALL') list = list.filter(p => p.direction === filterDirection)
    if (filterWallet !== 'ALL') list = list.filter(p => p.wallet_name === filterWallet)

    list.sort((a, b) => {
      const av = (a as any)[sortKey]
      const bv = (b as any)[sortKey]
      if (av == null) return 1
      if (bv == null) return -1
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
    return list
  }, [positions, search, filterStatus, filterDirection, filterWallet, sortKey, sortDir])

  const filteredSummary = useMemo(() => {
    const count = filtered.length
    const total_invested = filtered.reduce((s, p) => s + (p.invested_cost || 0), 0)
    const total_pl_usd = filtered.reduce((s, p) => s + (p.pl_usd || 0), 0)
    const winners = filtered.filter(p => (p.pl_usd || 0) > 0).length
    const losers = filtered.filter(p => (p.pl_usd || 0) < 0).length
    const win_rate = count > 0 ? (winners / count) * 100 : 0
    const total_pl_pct = total_invested > 0 ? (total_pl_usd / total_invested) * 100 : 0
    const fee_totali = filtered.reduce((s, p) => s + (p.fees_sell || 0), 0)
    return {
      count,
      total_invested,
      total_pl_usd,
      total_pl_pct,
      winners,
      losers,
      win_rate,
      fee_totali,
    }
  }, [filtered])

  const trendData = useMemo(() => {
    const perDay = new Map<string, { invested: number; proceeds: number }>()

    for (const p of filtered) {
      if (!p.date_close) continue
      const day = new Date(p.date_close).toISOString().slice(0, 10)
      const prev = perDay.get(day) || { invested: 0, proceeds: 0 }
      perDay.set(day, {
        invested: prev.invested + (p.invested_cost || 0),
        proceeds: prev.proceeds + (p.proceeds || 0),
      })
    }

    const sortedDays = Array.from(perDay.keys()).sort()
    let cumInvested = 0
    let cumProceeds = 0

    return sortedDays.map((day) => {
      const d = perDay.get(day)!
      cumInvested += d.invested
      cumProceeds += d.proceeds
      return {
        day,
        label: new Date(day).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }),
        invested: cumInvested,
        proceeds: cumProceeds,
      }
    })
  }, [filtered])

  const visibleCols = ALL_COLS.filter(c => colVis[c.key])

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  function renderCell(p: Position, key: string): React.ReactNode {
    switch (key) {
      case 'date_close':    return <span className="mono text-xs">{fmtDate(p.date_close)}</span>
      case 'date_open':     return <span className="mono text-xs text-neutral-400">{fmtDate(p.date_open)}</span>
      case 'holding_days':  return <span className="mono text-xs">{p.holding_days != null ? `${p.holding_days}g` : '—'}</span>
      case 'ticker':        return <span className="font-semibold tracking-wide">{p.ticker}</span>
      case 'direction':     return (
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${p.direction === 'SHORT' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'}`}>
          {p.direction}
        </span>
      )
      case 'action':        return (
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${p.action === 'SWAP' ? 'bg-purple-50 text-purple-600' : 'bg-slate-100 text-slate-600'}`}>
          {p.action}
        </span>
      )
      case 'wallet_name':   return <span className="text-xs text-neutral-600">{p.wallet_name || '—'}</span>
      case 'qty_sold':      return <span className="mono text-xs">{fmtQty(p.qty_sold)}</span>
      case 'entry_price':   return <span className="mono text-xs">{fmt(p.entry_price)}</span>
      case 'exit_price':    return <span className="mono text-xs">{fmt(p.exit_price)}</span>
      case 'invested_cost': return <span className="mono">{fmt(p.invested_cost)}</span>
      case 'proceeds':      return <span className="mono">{fmt(p.proceeds)}</span>
      case 'fees_sell':     return <span className="mono text-xs text-neutral-400">{p.fees_sell > 0 ? fmt(p.fees_sell) : '—'}</span>
      case 'pl_usd':        return <span className={`mono font-semibold ${clsPL(p.pl_usd)}`}>{fmt(p.pl_usd)}</span>
      case 'pl_pct':        return <span className={`mono font-semibold ${clsPL(p.pl_pct)}`}>{fmtPct(p.pl_pct)}</span>
      case 'qty_remaining': return <span className="mono text-xs text-neutral-400">{fmtQty(p.qty_remaining)}</span>
      case 'status':        return (
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${p.status === 'CLOSED' ? 'bg-neutral-100 text-neutral-500' : 'bg-amber-50 text-amber-600'}`}>
          {p.status === 'CLOSED' ? 'CLOSED' : 'PARZIALE'}
        </span>
      )
      case 'leverage':      return <span className="mono text-xs">{p.leverage != null ? `${p.leverage}×` : '—'}</span>
      case 'notes':         return <span className="text-xs text-neutral-500 truncate max-w-[180px] block">{p.notes || '—'}</span>
      default: return '—'
    }
  }

  if (loading) return (
    <div className="cp-page flex items-center gap-2 py-12 text-sm text-neutral-400">
      <style suppressHydrationWarning>{FONT_STYLE}</style>
      <span className="animate-spin">⟳</span> Caricamento posizioni chiuse…
    </div>
  )

  return (
    <div className="cp-page">
      <style suppressHydrationWarning>{FONT_STYLE}</style>

      <PageHeader title="Posizioni Chiuse" subtitle="Storico SELL e SWAP con P/L realizzato" />

      {error && <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}

      {/* KPI summary (dinamico sui filtri attivi) */}
      <div className="mb-4 grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: 'Operazioni',    value: String(filteredSummary.count),                          sub: `${filteredSummary.winners}W · ${filteredSummary.losers}L`, color: '' },
          { label: 'Win Rate',      value: `${filteredSummary.win_rate.toFixed(1)}%`,              sub: `${filteredSummary.winners} vincenti`,                      color: filteredSummary.win_rate >= 50 ? 'text-emerald-600' : 'text-red-500' },
          { label: 'Totale Invest.', value: fmt(filteredSummary.total_invested),                   sub: 'costo base totale',                                        color: '' },
          { label: 'P/L Totale $',  value: fmt(filteredSummary.total_pl_usd),                      sub: fmtPct(filteredSummary.total_pl_pct) + ' sul totale investito', color: clsPL(filteredSummary.total_pl_usd) },
          { label: 'Fee Totali',    value: fmt(filteredSummary.fee_totali),                        sub: 'commissioni pagate',                                       color: '' },
        ].map((k, i) => (
          <Card key={i}><CardBody>
            <div className="text-[11px] font-medium uppercase tracking-wider text-neutral-400 mb-1">{k.label}</div>
            <div className={`text-xl font-semibold ${k.color || 'text-neutral-800'}`}>{k.value}</div>
            <div className={`text-xs mt-1 ${k.color || 'text-neutral-400'}`}>{k.sub}</div>
          </CardBody></Card>
        ))}
      </div>

      <Card className="mb-4">
        <CardBody className="py-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-neutral-900">Andamento Posizioni Chiuse</div>
              <div className="text-xs text-neutral-500">Cumulato su operazioni filtrate</div>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="inline-flex items-center gap-1.5 text-neutral-600">
                <span className="h-2.5 w-2.5 rounded-full bg-slate-500" />
                Investito
              </span>
              <span className="inline-flex items-center gap-1.5 text-neutral-600">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                Ricavato
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
                    <linearGradient id="closedInvested" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#64748b" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#64748b" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="closedProceeds" x1="0" y1="0" x2="0" y2="1">
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
                    formatter={(v: any) => fmt(Number(v))}
                    labelFormatter={(label) => `Data: ${label}`}
                    contentStyle={{ borderRadius: 10, borderColor: '#e5e7eb' }}
                  />
                  <Area type="monotone" dataKey="invested" stroke="#475569" fill="url(#closedInvested)" strokeWidth={2} />
                  <Area type="monotone" dataKey="proceeds" stroke="#10b981" fill="url(#closedProceeds)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Table card */}
      <Card>
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-neutral-100">
          {/* Search */}
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Cerca ticker, wallet, note…"
            className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-sm w-52 focus:outline-none focus:border-slate-400"
          />

          {/* Status filter */}
          <div className="flex rounded-lg border border-neutral-200 overflow-hidden text-xs font-medium">
            {(['ALL', 'CLOSED', 'PARTIAL'] as const).map(v => (
              <button key={v} onClick={() => setFilterStatus(v)}
                className={`px-3 py-1.5 transition-colors ${filterStatus === v ? 'bg-slate-800 text-white' : 'bg-white text-neutral-500 hover:bg-neutral-50'}`}>
                {v === 'ALL' ? 'Tutti' : v === 'CLOSED' ? 'Chiuse' : 'Parziali'}
              </button>
            ))}
          </div>

          {/* Direction filter */}
          <div className="flex rounded-lg border border-neutral-200 overflow-hidden text-xs font-medium">
            {(['ALL', 'LONG', 'SHORT'] as const).map(v => (
              <button key={v} onClick={() => setFilterDirection(v)}
                className={`px-3 py-1.5 transition-colors ${filterDirection === v ? 'bg-slate-800 text-white' : 'bg-white text-neutral-500 hover:bg-neutral-50'}`}>
                {v}
              </button>
            ))}
          </div>

          {/* Wallet filter */}
          {wallets.length > 0 && (
            <select value={filterWallet} onChange={e => setFilterWallet(e.target.value)}
              className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-600 focus:outline-none focus:border-slate-400">
              <option value="ALL">Tutti i wallet</option>
              {wallets.map(w => <option key={w} value={w}>{w}</option>)}
            </select>
          )}

          <div className="ml-auto flex items-center gap-2">
            {(search || filterStatus !== 'ALL' || filterDirection !== 'ALL' || filterWallet !== 'ALL') && (
              <button
                onClick={() => {
                  setSearch('')
                  setFilterStatus('ALL')
                  setFilterDirection('ALL')
                  setFilterWallet('ALL')
                }}
                className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50"
              >
                Clear
              </button>
            )}
            <span className="text-xs text-neutral-400">{filtered.length} risultati</span>

            {/* Gear */}
            <div className="relative">
              <button onClick={() => setShowColPanel(v => !v)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${showColPanel ? 'border-slate-300 bg-slate-100 text-slate-700' : 'border-neutral-200 bg-white text-neutral-500 hover:border-neutral-300 hover:text-neutral-700'}`}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06-.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
                Colonne
              </button>
              <ColPanel visible={showColPanel} colVis={colVis} onChange={(k, v) => setColVis(p => ({ ...p, [k]: v }))} onClose={() => setShowColPanel(false)} />
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto max-h-[62vh]">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-white border-b border-neutral-100">
              <tr>
                {visibleCols.map(col => (
                  <th key={col.key}
                    onClick={() => toggleSort(col.key)}
                    className={`px-3.5 py-3 text-[10px] font-semibold uppercase tracking-widest whitespace-nowrap cursor-pointer select-none hover:text-slate-700 transition-colors
                      ${col.align === 'left' ? 'text-left' : col.align === 'center' ? 'text-center' : 'text-right'}
                      ${sortKey === col.key ? 'text-slate-700' : 'text-slate-400'}`}>
                    {col.label}
                    {sortKey === col.key && <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-50">
              {filtered.length === 0 ? (
                <tr><td colSpan={visibleCols.length} className="px-4 py-10 text-center text-sm text-neutral-300">Nessuna posizione trovata.</td></tr>
              ) : (
                filtered.map((p, idx) => (
                  <tr key={p.id} className={idx % 2 === 0 ? 'bg-white hover:bg-slate-50/60' : 'bg-neutral-50/40 hover:bg-slate-50/60'}>
                    {visibleCols.map(col => (
                      <td key={col.key}
                        className={`px-3.5 py-2.5 whitespace-nowrap
                          ${col.align === 'left' ? 'text-left' : col.align === 'center' ? 'text-center' : 'text-right'}`}>
                        {renderCell(p, col.key)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>

            {/* Footer totals */}
            {filtered.length > 0 && (
              <tfoot className="border-t-2 border-neutral-200 bg-neutral-50 sticky bottom-0">
                <tr>
                  {visibleCols.map(col => {
                    let content: React.ReactNode = null
                    if (col.key === 'ticker') content = <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Totale ({filtered.length})</span>
                    else if (col.key === 'invested_cost') content = <span className="mono text-sm font-semibold text-neutral-700">{fmt(filtered.reduce((s, p) => s + p.invested_cost, 0))}</span>
                    else if (col.key === 'proceeds') content = <span className="mono text-sm font-semibold text-neutral-700">{fmt(filtered.reduce((s, p) => s + p.proceeds, 0))}</span>
                    else if (col.key === 'fees_sell') content = <span className="mono text-sm text-neutral-500">{fmt(filtered.reduce((s, p) => s + p.fees_sell, 0))}</span>
                    else if (col.key === 'pl_usd') {
                      const tot = filtered.reduce((s, p) => s + p.pl_usd, 0)
                      content = <span className={`mono text-sm font-bold ${clsPL(tot)}`}>{fmt(tot)}</span>
                    }
                    else if (col.key === 'pl_pct') {
                      const totInv = filtered.reduce((s, p) => s + p.invested_cost, 0)
                      const totPl = filtered.reduce((s, p) => s + p.pl_usd, 0)
                      const totPct = totInv > 0 ? (totPl / totInv) * 100 : 0
                      content = <span className={`mono text-sm font-bold ${clsPL(totPct)}`}>{fmtPct(totPct)}</span>
                    }
                    return (
                      <td key={col.key}
                        className={`px-3.5 py-3 whitespace-nowrap
                          ${col.align === 'left' ? 'text-left' : col.align === 'center' ? 'text-center' : 'text-right'}`}>
                        {content}
                      </td>
                    )
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>
    </div>
  )
}
