'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'
import { usePrices } from '@/contexts/PricesContext'

const FONT_STYLE = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,300&family=DM+Mono:wght@400;500&display=swap');
  .wallet-detail * { font-family: 'DM Sans', sans-serif; }
  .wallet-detail .mono { font-family: 'DM Mono', monospace; }
  .wallet-detail th { letter-spacing: 0.04em; }
  .col-toggle-panel { backdrop-filter: blur(12px); }
`

function fmt(n: number) {
  const v = Number.isFinite(n) ? n : 0
  const abs = Math.abs(v)
  const max = abs > 0 && abs < 1 ? 12 : 2
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: abs > 0 && abs < 1 ? 0 : 2,
    maximumFractionDigits: max,
  }).format(v)
}

function fmtNum(n: number, maxDecimals = 12) {
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('en-US', { maximumFractionDigits: maxDecimals })
}
function fmtPct(n: number) {
  if (!Number.isFinite(n)) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}
function fmtPctPlain(n: number) {
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(2)}%`
}
function clsPL(v: number) {
  if (v > 0.001) return 'text-emerald-600'
  if (v < -0.001) return 'text-red-500'
  return 'text-neutral-500'
}
function pct(part: number, total: number): number {
  if (!total) return NaN
  return (part / total) * 100
}

type PositionRow = {
  ticker: string
  leverage?: number | null
  qty_open: number
  avg_cost: number | null
  invested_open: number
  notional_open?: number
  pl_realized: number
}
type LivePrices = Record<string, number | null>
type TreeNodeLite = {
  id: string
  global_live_value: number
  children?: TreeNodeLite[]
}

type ColGroup = 'base' | 'live' | 'weight_cost' | 'weight_live'

type ColDef = {
  key: string
  label: string
  group: ColGroup
  groupLabel: string
  groupColor: string
  defaultVisible: boolean
  align: 'left' | 'right'
}

const ALL_COLUMNS: ColDef[] = [
  { key: 'ticker',          label: 'Ticker',         group: 'base',        groupLabel: 'Base',         groupColor: 'text-slate-500',   defaultVisible: true,  align: 'left'  },
  { key: 'leverage',        label: 'Leva',           group: 'base',        groupLabel: 'Base',         groupColor: 'text-slate-500',   defaultVisible: true,  align: 'right' },
  { key: 'qty',             label: 'Qty Open',        group: 'base',        groupLabel: 'Base',         groupColor: 'text-slate-500',   defaultVisible: true,  align: 'right' },
  { key: 'avg_cost',        label: 'Avg Cost',        group: 'base',        groupLabel: 'Base',         groupColor: 'text-slate-500',   defaultVisible: true,  align: 'right' },
  { key: 'invested',        label: 'Invested',        group: 'base',        groupLabel: 'Base',         groupColor: 'text-slate-500',   defaultVisible: true,  align: 'right' },
  { key: 'pl_realized',     label: 'P/L Real.',       group: 'base',        groupLabel: 'Base',         groupColor: 'text-slate-500',   defaultVisible: true,  align: 'right' },
  { key: 'price_live',      label: 'Prezzo Live',     group: 'live',        groupLabel: 'Live',         groupColor: 'text-sky-500',     defaultVisible: true,  align: 'right' },
  { key: 'value_live',      label: 'Valore Live',     group: 'live',        groupLabel: 'Live',         groupColor: 'text-sky-500',     defaultVisible: true,  align: 'right' },
  { key: 'unreal_usd',      label: 'Unreal. $',       group: 'live',        groupLabel: 'Live',         groupColor: 'text-sky-500',     defaultVisible: true,  align: 'right' },
  { key: 'unreal_pct',      label: 'Unreal. %',       group: 'live',        groupLabel: 'Live',         groupColor: 'text-sky-500',     defaultVisible: true,  align: 'right' },
  { key: 'w_wallet_cost',   label: '% Wallet (cost)', group: 'weight_cost', groupLabel: 'Peso (cost)',  groupColor: 'text-violet-500',  defaultVisible: true,  align: 'right' },
  { key: 'w_root_cost',     label: '% Root (cost)',   group: 'weight_cost', groupLabel: 'Peso (cost)',  groupColor: 'text-violet-500',  defaultVisible: true,  align: 'right' },
  { key: 'w_wallet_live',   label: '% Wallet (live globale)', group: 'weight_live', groupLabel: 'Peso (live)',  groupColor: 'text-amber-500',   defaultVisible: true,  align: 'right' },
  { key: 'w_root_live',     label: '% Root (live globale)',   group: 'weight_live', groupLabel: 'Peso (live)',  groupColor: 'text-amber-500',   defaultVisible: true,  align: 'right' },
]

const GROUP_HEADER_COLORS: Record<ColGroup, string> = {
  base:        'text-slate-500',
  live:        'text-sky-500',
  weight_cost: 'text-violet-500',
  weight_live: 'text-amber-500',
}
const GROUP_CELL_COLORS: Record<ColGroup, string> = {
  base:        'text-slate-700',
  live:        'text-sky-700',
  weight_cost: 'text-violet-600',
  weight_live: 'text-amber-600',
}

async function fetchLivePrices(tickers: string[]): Promise<LivePrices> {
  if (tickers.length === 0) return {}
  try {
    const res = await fetch(`/api/prices/live?tickers=${tickers.join(',')}`)
    if (!res.ok) return tickers.reduce((a, t) => ({ ...a, [t]: null }), {} as LivePrices)
    const data = await res.json()
    return tickers.reduce((a, t) => ({
      ...a,
      [t]: data.prices?.[t] ?? null
    }), {} as LivePrices)
  } catch {
    return tickers.reduce((a, t) => ({ ...a, [t]: null }), {} as LivePrices)
  }
}

function ColumnTogglePanel({
  visible,
  colVisibility,
  onChange,
  onClose,
}: {
  visible: boolean
  colVisibility: Record<string, boolean>
  onChange: (key: string, val: boolean) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!visible) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [visible, onClose])

  if (!visible) return null

  const groups = ALL_COLUMNS.reduce((acc, col) => {
    if (!acc[col.group]) acc[col.group] = []
    acc[col.group].push(col)
    return acc
  }, {} as Record<string, ColDef[]>)

  return (
    <div
      ref={ref}
      className="col-toggle-panel absolute right-0 top-10 z-50 w-72 rounded-2xl border border-neutral-200 bg-white/95 shadow-2xl shadow-neutral-200/60 p-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-neutral-700" style={{ fontFamily: "'DM Sans', sans-serif" }}>
          Colonne visibili
        </span>
        <button
          onClick={onClose}
          className="text-neutral-400 hover:text-neutral-600 text-lg leading-none"
        >×</button>
      </div>

      <div className="space-y-4">
        {Object.entries(groups).map(([groupKey, cols]) => {
          const sample = cols[0]
          const allOn = cols.every(c => colVisibility[c.key])

          return (
            <div key={groupKey}>
              <div className="mb-1.5 flex items-center justify-between">
                <span className={`text-[11px] font-semibold uppercase tracking-widest ${sample.groupColor}`}>
                  {sample.groupLabel}
                </span>
                <button
                  onClick={() => cols.forEach(c => onChange(c.key, !allOn))}
                  className="text-[10px] text-neutral-400 hover:text-neutral-600"
                >
                  {allOn ? 'Nascondi tutti' : 'Mostra tutti'}
                </button>
              </div>
              <div className="space-y-1">
                {cols.map(col => (
                  col.key === 'ticker' ? null : (
                    <label key={col.key} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-neutral-50">
                      <input
                        type="checkbox"
                        checked={colVisibility[col.key] ?? true}
                        onChange={e => onChange(col.key, e.target.checked)}
                        className="h-3.5 w-3.5 rounded accent-slate-600"
                      />
                      <span className="text-xs text-neutral-600">{col.label}</span>
                    </label>
                  )
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-3 border-t border-neutral-100 pt-3">
        <button
          onClick={() => ALL_COLUMNS.forEach(c => onChange(c.key, c.defaultVisible))}
          className="text-xs text-neutral-400 hover:text-neutral-600 underline"
        >
          Ripristina default
        </button>
      </div>
    </div>
  )
}

export default function WalletDetailPage({ params }: { params: { id: string } }) {
  const walletId = params.id

  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<any>(null)
  const [livePrices, setLivePrices] = useState<LivePrices>({})
  const [loadingPrices, setLoadingPrices] = useState(false)
  const [showColPanel, setShowColPanel] = useState(false)
  const [colVisibility, setColVisibility] = useState<Record<string, boolean>>(
    () => ALL_COLUMNS.reduce((a, c) => ({ ...a, [c.key]: c.defaultVisible }), {})
  )
  const [walletGlobalLive, setWalletGlobalLive] = useState<number>(0)
  const [rootGlobalLive, setRootGlobalLive] = useState<number>(0)

  const { lastUpdate } = usePrices()

  const toggleCol = (key: string, val: boolean) => setColVisibility(prev => ({ ...prev, [key]: val }))

  const findNode = (nodes: TreeNodeLite[], id: string): TreeNodeLite | null => {
    for (const n of nodes) {
      if (n.id === id) return n
      const found = findNode(n.children || [], id)
      if (found) return found
    }
    return null
  }

  const load = async () => {
    setLoading(true)
    const [resSummary, resTree] = await Promise.all([
      fetch(`/api/wallets/${walletId}/accounting-summary`),
      fetch('/api/portfolio/tree'),
    ])
    const [json, treeJson] = await Promise.all([resSummary.json(), resTree.json()])
    setData(json)
    if (resTree.ok && treeJson?.tree) {
      const walletNode = findNode(treeJson.tree as TreeNodeLite[], walletId)
      const rootId = String(json?.root?.id || '')
      const rootNode = rootId ? findNode(treeJson.tree as TreeNodeLite[], rootId) : null
      setWalletGlobalLive(Number(walletNode?.global_live_value || 0))
      setRootGlobalLive(Number(rootNode?.global_live_value || 0))
    } else {
      setWalletGlobalLive(0)
      setRootGlobalLive(0)
    }
    setLoading(false)
    const tickers: string[] = (json?.positions || []).map((p: PositionRow) => p.ticker)
    if (tickers.length > 0) {
      setLoadingPrices(true)
      try { setLivePrices(await fetchLivePrices(tickers)) }
      finally { setLoadingPrices(false) }
    }
  }

  useEffect(() => { load() }, [walletId])

  // Auto-reload when prices are updated
  useEffect(() => {
    if (lastUpdate) {
      const tickers: string[] = (data?.positions || []).map((p: PositionRow) => p.ticker)
      if (tickers.length > 0) {
        setLoadingPrices(true)
        fetchLivePrices(tickers).then(setLivePrices).finally(() => setLoadingPrices(false))
      }
    }
  }, [lastUpdate, data])

  const positions: PositionRow[] = useMemo(() => data?.positions || [], [data])

  if (loading) return (
    <div className="wallet-detail flex items-center gap-2 py-12 text-sm text-neutral-400">
      <style suppressHydrationWarning>{FONT_STYLE}</style>
      <span className="animate-spin text-base">⟳</span> Caricamento…
    </div>
  )
  if (data?.error) return <div className="text-sm text-red-500">Errore: {data.error}</div>

  const rootDeposits = Number(data?.root?.deposits ?? 0)
  const investedOpen = Number(data?.summary?.invested_open ?? 0)
  const plRealized = Number(data?.summary?.pl_realized ?? 0)
  const feesTotal = Number(data?.summary?.fees_total ?? 0)
  const cashDirect = Number(data?.summary?.cash_direct ?? 0)
  const cashAllocated = Number(data?.summary?.cash_allocated ?? data?.summary?.cash_balance ?? 0)
  const cash = cashAllocated
  const budget = Number(data?.summary?.budget ?? 0)
  const targetPct = Number(data?.settings?.target_pct ?? 0)

  const totalValueLive = positions.reduce((s, p) => {
    const price = livePrices[p.ticker]; return price != null ? s + p.qty_open * price : s
  }, 0)
  const totalUnrealizedUsd = positions.reduce((s, p) => {
    const price = livePrices[p.ticker]
    const entryNotional = Number(p.notional_open ?? p.invested_open ?? 0)
    return price != null ? s + (p.qty_open * price - entryNotional) : s
  }, 0)
  const hasAnyLivePrice = positions.some(p => livePrices[p.ticker] != null)
  const walletLiveTotal = cash + totalValueLive
  const walletLiveBase = walletGlobalLive > 0 ? walletGlobalLive : (walletLiveTotal > 0 ? walletLiveTotal : NaN)
  const rootLiveBase = rootGlobalLive > 0 ? rootGlobalLive : NaN

  const visibleCols = ALL_COLUMNS.filter(c => c.key === 'ticker' || colVisibility[c.key])

  return (
    <div className="wallet-detail">
      <style suppressHydrationWarning>{FONT_STYLE}</style>

      <PageHeader
        title={data.wallet?.name || 'Wallet'}
        subtitle={`${data.root?.name || ''} · Target: ${targetPct.toFixed(1)}% (${fmt(budget)})`}
      />

      <div className="mb-4 grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          {
            label: 'Cash Operativo',
            value: fmt(cash),
            sub: `cashflow diretto (solo movimenti wallet): ${fmt(cashDirect)}`,
            accent: false,
          },
          {
            label: 'Investito (open)',
            value: fmt(investedOpen),
            sub: `${fmtPctPlain(pct(investedOpen, walletLiveBase))} del valore globale wallet`,
            accent: false,
          },
          {
            label: 'Valore Live',
            value: hasAnyLivePrice ? fmt(walletLiveTotal) : fmt(cash),
            sub: hasAnyLivePrice
              ? `cash ${fmt(cash)} + investito live ${fmt(totalValueLive)}`
              : 'solo cash (prezzi live non collegati)',
            accent: hasAnyLivePrice,
            accentColor: hasAnyLivePrice ? clsPL(totalUnrealizedUsd) : 'text-neutral-700',
          },
          {
            label: 'P/L Realizzato',
            value: fmt(plRealized),
            sub: 'storico posizioni chiuse',
            accent: true,
            accentColor: clsPL(plRealized),
          },
          {
            label: 'Fee Totali',
            value: fmt(feesTotal),
            sub: 'commissioni cumulative',
            accent: true,
            accentColor: 'text-amber-600',
          },
        ].map((kpi, i) => (
          <Card key={i}>
            <CardBody>
              <div className="text-[11px] font-medium uppercase tracking-wider text-neutral-400 mb-1">
                {kpi.label}
              </div>
              <div className={`text-xl font-semibold ${kpi.accent ? kpi.accentColor : 'text-neutral-800'}`}>
                {kpi.value}
              </div>
              <div className={`text-xs mt-1 ${kpi.accent && kpi.accentColor ? kpi.accentColor : 'text-neutral-400'}`}>
                {kpi.sub}
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card>
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-neutral-700">Posizioni</span>
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-500">
              {positions.length}
            </span>
            {loadingPrices && (
              <span className="text-[11px] text-sky-500 flex items-center gap-1">
                <span className="animate-spin">⟳</span> prezzi live…
              </span>
            )}
          </div>

          <div className="relative">
            <button
              onClick={() => setShowColPanel(v => !v)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                showColPanel
                  ? 'border-slate-300 bg-slate-100 text-slate-700'
                  : 'border-neutral-200 bg-white text-neutral-500 hover:border-neutral-300 hover:text-neutral-700'
              }`}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
              Colonne
            </button>
            <ColumnTogglePanel
              visible={showColPanel}
              colVisibility={colVisibility}
              onChange={toggleCol}
              onClose={() => setShowColPanel(false)}
            />
          </div>
        </div>

        <div className="overflow-x-auto max-h-[58vh]">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 z-10 bg-white border-b border-neutral-100">
              <tr>
                {visibleCols.map(col => (
                  <th
                    key={col.key}
                    className={`px-3.5 py-3 text-[10px] font-semibold uppercase tracking-widest whitespace-nowrap ${
                      col.align === 'left' ? 'text-left' : 'text-right'
                    } ${GROUP_HEADER_COLORS[col.group]}`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-neutral-50">
              {positions.length === 0 ? (
                <tr>
                  <td
                    colSpan={visibleCols.length}
                    className="px-4 py-10 text-center text-sm text-neutral-300"
                  >
                    Nessuna posizione trovata.
                  </td>
                </tr>
              ) : (
                positions.map((p, idx) => {
                  const qty = Number(p.qty_open || 0)
                  const invested = Number(p.invested_open || 0)
                  const entryNotional = Number(p.notional_open ?? p.invested_open ?? 0)
                  const plReal = Number(p.pl_realized || 0)
                  const avgCostVal = p.avg_cost ? Number(p.avg_cost) : null
                  const livePrice = livePrices[p.ticker] ?? null
                  const unrealizedUsd = livePrice != null ? (qty * livePrice - entryNotional) : null
                  const valueLive = unrealizedUsd != null ? invested + unrealizedUsd : null
                  const unrealizedPct = unrealizedUsd != null && invested > 0 ? (unrealizedUsd / invested) * 100 : null
                  const weightWalletCost = pct(invested, investedOpen)
                  const weightRootCost = pct(invested, rootDeposits)
                  const weightWalletLive = valueLive != null ? pct(valueLive, walletLiveBase) : null
                  const weightRootLive = valueLive != null ? pct(valueLive, rootLiveBase) : null

                  const cellValues: Record<string, React.ReactNode> = {
                    ticker:        <span className="font-semibold tracking-wide text-neutral-800">{p.ticker}</span>,
                    leverage:      p.leverage && p.leverage > 1 ? <span className="mono font-medium text-indigo-700">x{p.leverage}</span> : <span className="text-neutral-300">—</span>,
                    qty:           <span className="mono text-xs text-neutral-600">{fmtNum(qty, 12)}</span>,
                    avg_cost:      <span className="mono text-xs">{avgCostVal != null ? fmt(avgCostVal) : <span className="text-neutral-300">—</span>}</span>,
                    invested:      <span className="mono font-medium">{fmt(invested)}</span>,
                    pl_realized:   <span className={`mono font-medium ${clsPL(plReal)}`}>{fmt(plReal)}</span>,
                    price_live:    livePrice != null ? <span className="mono">{fmt(livePrice)}</span> : <span className="text-neutral-300">—</span>,
                    value_live:    valueLive != null ? <span className="mono font-medium">{fmt(valueLive)}</span> : <span className="text-neutral-300">—</span>,
                    unreal_usd:    unrealizedUsd != null ? <span className={`mono font-medium ${clsPL(unrealizedUsd)}`}>{fmt(unrealizedUsd)}</span> : <span className="text-neutral-300">—</span>,
                    unreal_pct:    unrealizedPct != null ? <span className={`mono font-medium ${clsPL(unrealizedPct)}`}>{fmtPct(unrealizedPct)}</span> : <span className="text-neutral-300">—</span>,
                    w_wallet_cost: <span className="mono">{fmtPctPlain(weightWalletCost)}</span>,
                    w_root_cost:   <span className="mono">{fmtPctPlain(weightRootCost)}</span>,
                    w_wallet_live: weightWalletLive != null ? <span className="mono">{fmtPctPlain(weightWalletLive)}</span> : <span className="text-neutral-300">—</span>,
                    w_root_live:   weightRootLive != null ? <span className="mono">{fmtPctPlain(weightRootLive)}</span> : <span className="text-neutral-300">—</span>,
                  }

                  return (
                    <tr key={p.ticker} className={idx % 2 === 0 ? 'bg-white hover:bg-slate-50/60' : 'bg-neutral-50/40 hover:bg-slate-50/60'}>
                      {visibleCols.map(col => (
                        <td
                          key={col.key}
                          className={`px-3.5 py-3 whitespace-nowrap ${col.align === 'right' ? 'text-right' : 'text-left'} ${GROUP_CELL_COLORS[col.group]}`}
                        >
                          {cellValues[col.key]}
                        </td>
                      ))}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 py-2.5 border-t border-neutral-100">
          {[
            { label: 'Cost basis', color: 'bg-slate-400' },
            { label: 'Live', color: 'bg-sky-400' },
            { label: 'Peso (cost)', color: 'bg-violet-400' },
            { label: 'Peso (live)', color: 'bg-amber-400' },
          ].map(g => (
            <div key={g.label} className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${g.color}`} />
              <span className="text-[11px] text-neutral-400">{g.label}</span>
            </div>
          ))}
          {!hasAnyLivePrice && !loadingPrices && (
            <span className="ml-auto text-[11px] text-neutral-400">
              Prezzi in caricamento…
            </span>
          )}
        </div>
      </Card>
    </div>
  )
}
