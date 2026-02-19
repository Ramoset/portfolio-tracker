'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'
import { Wallet as WalletIcon, Edit2, Check, X, AlertCircle, Shield, AlertTriangle } from 'lucide-react'

type Wallet = {
  id: string
  name: string
  level: number
  parent_id: string | null
  target_allocation: number | null
  actual_allocation: number | null
  cash_reserve_pct: number | null
  total_invested: number
  cash_balance: number
  cash_reserve: number
  cash_available: number
  total_value_live: number
  pl_unrealized: number
  pl_realized: number
  pl_total: number
  pl_total_pct: number
  children: Wallet[]
}

type WalletRowModel = {
  key: string
  kind: 'ROOT' | 'WALLET' | 'CASH_RESERVE'
  wallet: Wallet
  rootId: string
  rootName: string
  depth: number
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

const clsPL = (v: number | null) => {
  if (v == null) return 'text-neutral-400'
  if (v > 0.01) return 'text-emerald-600'
  if (v < -0.01) return 'text-red-600'
  return 'text-neutral-500'
}

function checkRootNeedsReallocation(root: Wallet): { needsReallocation: boolean; totalAllocated: number; unallocated: number } {
  const childrenTotal = root.children.reduce((sum, c) => sum + (c.target_allocation || 0), 0)
  const needsReallocation = Math.abs(childrenTotal - 100) > 0.01
  return {
    needsReallocation,
    totalAllocated: childrenTotal,
    unallocated: 100 - childrenTotal,
  }
}

function collectRows(roots: Wallet[]): WalletRowModel[] {
  const rows: WalletRowModel[] = []

  const walkChildren = (children: Wallet[], root: Wallet, depth: number) => {
    children.forEach((child) => {
      rows.push({
        key: child.id,
        kind: 'WALLET',
        wallet: child,
        rootId: root.id,
        rootName: root.name,
        depth,
      })
      if (child.children?.length) walkChildren(child.children, root, depth + 1)
    })
  }

  roots.forEach((root) => {
    rows.push({
      key: root.id,
      kind: 'ROOT',
      wallet: root,
      rootId: root.id,
      rootName: root.name,
      depth: 0,
    })

    rows.push({
      key: `${root.id}::cash-reserve`,
      kind: 'CASH_RESERVE',
      wallet: root,
      rootId: root.id,
      rootName: root.name,
      depth: 1,
    })

    walkChildren(root.children || [], root, 1)
  })

  return rows
}

function WalletTableRow({
  row,
  allWallets,
  onReload,
}: {
  row: WalletRowModel
  allWallets: Wallet[]
  onReload: () => void
}) {
  const { wallet, kind, depth } = row
  const isRoot = kind === 'ROOT'
  const isCashReserve = kind === 'CASH_RESERVE'

  const [editingTarget, setEditingTarget] = useState(false)
  const [editingCashReserve, setEditingCashReserve] = useState(false)
  const [targetValue, setTargetValue] = useState(wallet.target_allocation?.toString() || '')
  const [cashReserveValue, setCashReserveValue] = useState(wallet.cash_reserve_pct?.toString() || '0')

  const siblings = allWallets.filter((w) => w.parent_id === wallet.parent_id && w.id !== wallet.id)
  const siblingsTotal = siblings.reduce((sum, w) => sum + (w.target_allocation || 0), 0)
  const availableSpace = 100 - siblingsTotal

  const totalRootCash = wallet.cash_balance + wallet.cash_reserve
  const cashReservePct = wallet.cash_reserve_pct || 0
  const cashReserveAmount = (totalRootCash * cashReservePct) / 100

  const reallocationStatus = isRoot ? checkRootNeedsReallocation(wallet) : null

  const handleSaveTarget = async () => {
    const value = parseFloat(targetValue)

    if (isNaN(value)) {
      alert('Inserisci un numero valido')
      return
    }

    if (value < 0 || value > 100) {
      alert('La percentuale deve essere tra 0 e 100')
      return
    }

    const newTotal = siblingsTotal + value
    if (newTotal > 100) {
      alert(
        `❌ Spazio insufficiente!\n\n` +
          `Allocazione totale: ${newTotal.toFixed(1)}%\n` +
          `Massimo disponibile: ${availableSpace.toFixed(1)}%\n\n` +
          `Riduci la percentuale o modifica gli altri wallet.`
      )
      return
    }

    try {
      const res = await fetch(`/api/wallets/${wallet.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_allocation_percent: value }),
      })

      if (!res.ok) throw new Error('Errore aggiornamento')

      setEditingTarget(false)
      onReload()
    } catch (e: any) {
      alert('Errore: ' + e.message)
    }
  }

  const handleSaveCashReserve = async () => {
    const value = parseFloat(cashReserveValue)

    if (isNaN(value)) {
      alert('Inserisci un numero valido')
      return
    }

    if (value < 0 || value > 100) {
      alert('La percentuale deve essere tra 0 e 100')
      return
    }

    try {
      const res = await fetch(`/api/wallets/${wallet.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cash_reserve_pct: value }),
      })

      if (!res.ok) throw new Error('Errore aggiornamento')

      setEditingCashReserve(false)
      onReload()
    } catch (e: any) {
      alert('Errore: ' + e.message)
    }
  }

  return (
    <tr className={`hover:bg-neutral-50 ${isRoot ? 'bg-neutral-50/70' : isCashReserve ? 'bg-green-50/50' : ''}`}>
      <td className="px-4 py-3 text-xs text-neutral-500">{row.rootName}</td>

      <td className="px-4 py-3" style={{ paddingLeft: `${16 + depth * 20}px` }}>
        <div className="flex items-center gap-2">
          <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${isCashReserve ? 'bg-green-100' : 'bg-neutral-100'}`}>
            {isCashReserve ? <Shield className="h-4 w-4 text-green-700" /> : <WalletIcon className="h-4 w-4 text-neutral-700" />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {isCashReserve ? (
                <span className="text-sm font-semibold text-green-900">Cash Reserve</span>
              ) : (
                <Link href={`/wallets/${wallet.id}`} className={`text-sm hover:underline ${isRoot ? 'font-bold' : 'font-medium'}`}>
                  {wallet.name}
                </Link>
              )}
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  isRoot
                    ? 'bg-purple-100 text-purple-700'
                    : isCashReserve
                      ? 'bg-green-100 text-green-700'
                      : 'bg-blue-100 text-blue-700'
                }`}
              >
                {isRoot ? 'ROOT' : isCashReserve ? 'CASH' : `L${wallet.level}`}
              </span>
              {reallocationStatus?.needsReallocation && (
                <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-orange-100 text-orange-700 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  Riallocare!
                </span>
              )}
            </div>
            <div className="text-xs text-neutral-500">
              {isCashReserve ? 'Riserva di sicurezza non investibile' : isRoot ? 'Root wallet' : 'Sub-wallet'}
            </div>
          </div>
        </div>
      </td>

      <td className="px-4 py-3 text-center text-xs text-neutral-500">{isCashReserve ? 'CASH RESERVE' : isRoot ? 'ROOT' : 'OPERATIVO'}</td>

      <td className="px-4 py-3 text-right">
        {isCashReserve ? (
          editingCashReserve ? (
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={cashReserveValue}
                  onChange={(e) => setCashReserveValue(e.target.value)}
                  className="w-20 px-2 py-1 text-sm border rounded text-right"
                  min="0"
                  max="100"
                  step="1"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveCashReserve()
                    if (e.key === 'Escape') {
                      setEditingCashReserve(false)
                      setCashReserveValue(wallet.cash_reserve_pct?.toString() || '0')
                    }
                  }}
                />
                <button onClick={handleSaveCashReserve} className="p-1 text-green-600 hover:bg-green-50 rounded"><Check className="w-4 h-4" /></button>
                <button
                  onClick={() => {
                    setEditingCashReserve(false)
                    setCashReserveValue(wallet.cash_reserve_pct?.toString() || '0')
                  }}
                  className="p-1 text-red-600 hover:bg-red-50 rounded"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-2">
              <span className="text-sm font-semibold text-green-900">{cashReservePct.toFixed(1)}%</span>
              <button
                onClick={() => {
                  setCashReserveValue(wallet.cash_reserve_pct?.toString() || '0')
                  setEditingCashReserve(true)
                }}
                className="p-1 text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 rounded"
              >
                <Edit2 className="w-3 h-3" />
              </button>
            </div>
          )
        ) : editingTarget ? (
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
                className="w-20 px-2 py-1 text-sm border rounded text-right"
                min="0"
                max={availableSpace}
                step="0.1"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveTarget()
                  if (e.key === 'Escape') {
                    setEditingTarget(false)
                    setTargetValue(wallet.target_allocation?.toString() || '')
                  }
                }}
              />
              <button onClick={handleSaveTarget} className="p-1 text-green-600 hover:bg-green-50 rounded"><Check className="w-4 h-4" /></button>
              <button
                onClick={() => {
                  setEditingTarget(false)
                  setTargetValue(wallet.target_allocation?.toString() || '')
                }}
                className="p-1 text-red-600 hover:bg-red-50 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-center gap-1 text-xs text-amber-600">
              <AlertCircle className="w-3 h-3" />
              <span>Disp: {availableSpace.toFixed(1)}%</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2">
            <span className="text-sm text-neutral-700">{wallet.target_allocation != null ? `${wallet.target_allocation.toFixed(1)}%` : '—'}</span>
            {!isRoot && (
              <button
                onClick={() => {
                  setTargetValue(wallet.target_allocation?.toString() || '')
                  setEditingTarget(true)
                }}
                className="p-1 text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 rounded"
              >
                <Edit2 className="w-3 h-3" />
              </button>
            )}
          </div>
        )}
      </td>

      <td className="px-4 py-3 text-right text-sm text-neutral-600">{isCashReserve ? '—' : wallet.actual_allocation != null ? `${wallet.actual_allocation.toFixed(1)}%` : '—'}</td>

      <td className="px-4 py-3 text-right text-sm font-semibold text-blue-600">{isCashReserve ? fmtUsd(cashReserveAmount, 0) : fmtUsd(wallet.cash_balance, 0)}</td>
      <td className="px-4 py-3 text-right text-sm font-semibold">{isCashReserve ? '—' : fmtUsd(wallet.total_invested, 0)}</td>
      <td className="px-4 py-3 text-right text-sm font-semibold">{isCashReserve ? '—' : wallet.total_value_live > 0 ? fmtUsd(wallet.total_value_live, 0) : '—'}</td>
      <td className={`px-4 py-3 text-right text-sm font-semibold ${isCashReserve ? 'text-neutral-400' : clsPL(wallet.pl_unrealized)}`}>{isCashReserve ? '—' : fmtUsd(wallet.pl_unrealized, 0)}</td>
      <td className={`px-4 py-3 text-right text-sm font-semibold ${isCashReserve ? 'text-neutral-400' : clsPL(wallet.pl_realized)}`}>{isCashReserve ? '—' : fmtUsd(wallet.pl_realized, 0)}</td>
      <td className={`px-4 py-3 text-right text-sm font-bold ${isCashReserve ? 'text-neutral-400' : clsPL(wallet.pl_total)}`}>{isCashReserve ? '—' : fmtUsd(wallet.pl_total, 0)}</td>
      <td className={`px-4 py-3 text-right text-sm font-bold ${isCashReserve ? 'text-neutral-400' : clsPL(wallet.pl_total_pct)}`}>{isCashReserve ? '—' : fmtPct(wallet.pl_total_pct)}</td>
    </tr>
  )
}

export default function WalletsPage() {
  const [tree, setTree] = useState<Wallet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exportingWallets, setExportingWallets] = useState<'CSV' | 'EXCEL' | null>(null)

  const [search, setSearch] = useState('')
  const [filterRoot, setFilterRoot] = useState('ALL')
  const [filterKind, setFilterKind] = useState<'ALL' | 'ROOT' | 'WALLET' | 'CASH_RESERVE'>('ALL')
  const [filterLevel, setFilterLevel] = useState<'ALL' | '0' | '1' | '2' | '3+'>('ALL')
  const [filterPl, setFilterPl] = useState<'ALL' | 'POS' | 'NEG' | 'ZERO'>('ALL')

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/portfolio/tree')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Errore caricamento')
      setTree(json.tree || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const allWallets = useMemo(() => {
    const flatten = (wallets: Wallet[]): Wallet[] =>
      wallets.reduce((acc, w) => [...acc, w, ...flatten(w.children || [])], [] as Wallet[])
    return flatten(tree)
  }, [tree])

  const rows = useMemo(() => collectRows(tree), [tree])

  const rootsNeedingReallocation = useMemo(
    () => tree.filter((root) => checkRootNeedsReallocation(root).needsReallocation),
    [tree]
  )

  const filteredRows = useMemo(() => {
    let list = [...rows]

    if (search.trim()) {
      const s = search.trim().toLowerCase()
      list = list.filter((r) => r.wallet.name.toLowerCase().includes(s) || r.rootName.toLowerCase().includes(s))
    }

    if (filterRoot !== 'ALL') list = list.filter((r) => r.rootId === filterRoot)
    if (filterKind !== 'ALL') list = list.filter((r) => r.kind === filterKind)

    if (filterLevel !== 'ALL') {
      list = list.filter((r) => {
        if (r.kind !== 'WALLET' && r.kind !== 'ROOT') return false
        if (filterLevel === '3+') return r.wallet.level >= 3
        return r.wallet.level === Number(filterLevel)
      })
    }

    if (filterPl !== 'ALL') {
      list = list.filter((r) => {
        if (r.kind === 'CASH_RESERVE') return false
        const pl = r.wallet.pl_total
        if (filterPl === 'POS') return pl > 0.01
        if (filterPl === 'NEG') return pl < -0.01
        return Math.abs(pl) <= 0.01
      })
    }

    return list
  }, [rows, search, filterRoot, filterKind, filterLevel, filterPl])

  const summary = useMemo(() => {
    const walletRows = filteredRows.filter((r) => r.kind === 'WALLET')
    const rootRows = filteredRows.filter((r) => r.kind === 'ROOT')
    const cashRows = filteredRows.filter((r) => r.kind === 'CASH_RESERVE')

    return {
      visibleRows: filteredRows.length,
      visibleRoots: rootRows.length,
      visibleWallets: walletRows.length,
      visibleCashRows: cashRows.length,
      invested: walletRows.reduce((s, r) => s + r.wallet.total_invested, 0),
      plTotal: walletRows.reduce((s, r) => s + r.wallet.pl_total, 0),
    }
  }, [filteredRows])

  const escCsv = (value: unknown): string => {
    const raw = value == null ? '' : String(value)
    if (/[",\n\r]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`
    return raw
  }

  const formatNumber = (value: number | null | undefined): string => {
    if (value == null || !Number.isFinite(value)) return ''
    return String(value)
  }

  const buildWalletsCsv = () => {
    const headers = [
      'root',
      'wallet',
      'tipo',
      'livello',
      'target_pct',
      'actual_pct',
      'cash_wallet',
      'invested',
      'value_live',
      'pl_unrealized',
      'pl_realized',
      'pl_total',
      'roi_pct',
    ]
    const rows = filteredRows.map((row) => {
      const isCashReserve = row.kind === 'CASH_RESERVE'
      return {
        root: row.rootName,
        wallet: row.wallet.name,
        tipo: row.kind,
        livello: row.wallet.level,
        target_pct: formatNumber(row.wallet.target_allocation),
        actual_pct: formatNumber(row.wallet.actual_allocation),
        cash_wallet: isCashReserve
          ? formatNumber((row.wallet.cash_balance + row.wallet.cash_reserve) * ((row.wallet.cash_reserve_pct || 0) / 100))
          : formatNumber(row.wallet.cash_balance),
        invested: isCashReserve ? '' : formatNumber(row.wallet.total_invested),
        value_live: isCashReserve ? '' : formatNumber(row.wallet.total_value_live),
        pl_unrealized: isCashReserve ? '' : formatNumber(row.wallet.pl_unrealized),
        pl_realized: isCashReserve ? '' : formatNumber(row.wallet.pl_realized),
        pl_total: isCashReserve ? '' : formatNumber(row.wallet.pl_total),
        roi_pct: isCashReserve ? '' : formatNumber(row.wallet.pl_total_pct),
      }
    })

    const lines = [headers.join(',')]
    for (const row of rows) {
      lines.push(headers.map((h) => escCsv((row as any)[h])).join(','))
    }
    return `\uFEFF${lines.join('\n')}`
  }

  const downloadTextFile = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const handleExportWallets = (mode: 'CSV' | 'EXCEL') => {
    setExportingWallets(mode)
    try {
      const today = new Date().toISOString().slice(0, 10)
      const csv = buildWalletsCsv()
      if (mode === 'EXCEL') {
        // Excel opens UTF-8 CSV correctly with BOM.
        downloadTextFile(csv, `wallets-export-${today}.csv`, 'text/csv;charset=utf-8')
      } else {
        downloadTextFile(csv, `wallets-export-${today}.csv`, 'text/csv;charset=utf-8')
      }
    } finally {
      setExportingWallets(null)
    }
  }

  return (
    <div>
      <PageHeader
        title="Wallets"
        subtitle="Vista unica con filtri rapidi su root, livelli, tipo e P/L"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleExportWallets('CSV')}
              disabled={exportingWallets !== null}
              className="rounded-xl border border-emerald-200 bg-white px-3 py-1.5 text-sm text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
            >
              {exportingWallets === 'CSV' ? 'Exporting...' : 'Export CSV'}
            </button>
            <button
              onClick={() => handleExportWallets('EXCEL')}
              disabled={exportingWallets !== null}
              className="rounded-xl border border-teal-200 bg-white px-3 py-1.5 text-sm text-teal-700 hover:bg-teal-50 disabled:opacity-50"
            >
              {exportingWallets === 'EXCEL' ? 'Exporting...' : 'Export Excel'}
            </button>
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

      {rootsNeedingReallocation.length > 0 && (
        <div className="mb-4 rounded-xl bg-orange-50 border-2 border-orange-200 px-4 py-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-orange-900 mb-1">⚠️ Riallocazione Necessaria</div>
              <div className="text-sm text-orange-800">
                {rootsNeedingReallocation.length === 1 ? (
                  <>
                    Il wallet <strong>{rootsNeedingReallocation[0].name}</strong> ha una somma di allocazioni{' '}
                    {checkRootNeedsReallocation(rootsNeedingReallocation[0]).totalAllocated > 100 ? 'superiore' : 'inferiore'} al 100%.
                  </>
                ) : (
                  <>
                    <strong>{rootsNeedingReallocation.length} wallet root</strong> hanno allocazioni non bilanciate.
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {error && <div className="mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>}

      {!loading && (
        <div className="mb-4 grid grid-cols-2 lg:grid-cols-6 gap-3">
          <Card>
            <CardBody>
              <div className="text-xs text-neutral-500 uppercase">Righe visibili</div>
              <div className="text-xl font-semibold">{summary.visibleRows}</div>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <div className="text-xs text-neutral-500 uppercase">Root visibili</div>
              <div className="text-xl font-semibold">{summary.visibleRoots}</div>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <div className="text-xs text-neutral-500 uppercase">Wallet visibili</div>
              <div className="text-xl font-semibold">{summary.visibleWallets}</div>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <div className="text-xs text-neutral-500 uppercase">Cash reserve visibili</div>
              <div className="text-xl font-semibold">{summary.visibleCashRows}</div>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <div className="text-xs text-neutral-500 uppercase">Investito (wallet)</div>
              <div className="text-xl font-semibold">{fmtUsd(summary.invested, 0)}</div>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <div className="text-xs text-neutral-500 uppercase">P/L Totale (wallet)</div>
              <div className={`text-xl font-semibold ${clsPL(summary.plTotal)}`}>{fmtUsd(summary.plTotal, 0)}</div>
            </CardBody>
          </Card>
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-neutral-100">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca wallet o root..."
            className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-sm w-56 focus:outline-none focus:border-slate-400"
          />

          <select
            value={filterRoot}
            onChange={(e) => setFilterRoot(e.target.value)}
            className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm"
          >
            <option value="ALL">Tutti i root</option>
            {tree.map((root) => (
              <option key={root.id} value={root.id}>{root.name}</option>
            ))}
          </select>

          <div className="flex rounded-lg border border-neutral-200 overflow-hidden text-xs font-medium">
            {(['ALL', 'ROOT', 'WALLET', 'CASH_RESERVE'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setFilterKind(v)}
                className={`px-2.5 py-1.5 ${filterKind === v ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-600 hover:bg-neutral-50'}`}
              >
                {v === 'ALL' ? 'Tutti' : v === 'CASH_RESERVE' ? 'Cash' : v}
              </button>
            ))}
          </div>

          <select
            value={filterLevel}
            onChange={(e) => setFilterLevel(e.target.value as 'ALL' | '0' | '1' | '2' | '3+')}
            className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm"
          >
            <option value="ALL">Tutti i livelli</option>
            <option value="0">L0</option>
            <option value="1">L1</option>
            <option value="2">L2</option>
            <option value="3+">L3+</option>
          </select>

          <div className="flex rounded-lg border border-neutral-200 overflow-hidden text-xs font-medium">
            {(['ALL', 'POS', 'NEG', 'ZERO'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setFilterPl(v)}
                className={`px-2.5 py-1.5 ${filterPl === v ? 'bg-slate-700 text-white' : 'bg-white text-neutral-600 hover:bg-neutral-50'}`}
              >
                {v === 'ALL' ? 'P/L tutti' : v === 'POS' ? 'P/L +' : v === 'NEG' ? 'P/L -' : 'P/L 0'}
              </button>
            ))}
          </div>

          <button
            onClick={() => {
              setSearch('')
              setFilterRoot('ALL')
              setFilterKind('ALL')
              setFilterLevel('ALL')
              setFilterPl('ALL')
            }}
            className="ml-auto rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50"
          >
            Clear
          </button>
        </div>

        <CardBody className="p-0">
          {loading ? (
            <div className="px-4 py-12 text-center text-sm text-neutral-500">Caricamento wallets...</div>
          ) : filteredRows.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <WalletIcon className="mx-auto h-12 w-12 text-neutral-300 mb-3" />
              <div className="text-sm text-neutral-500 mb-1">Nessun risultato con questi filtri.</div>
              <div className="text-xs text-neutral-400">Prova a cambiare root, livello o tipo.</div>
            </div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full">
                <thead className="bg-neutral-50 border-b border-neutral-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase">Root</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-neutral-500 uppercase">Wallet</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-neutral-500 uppercase">Tipo</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase">Target %</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase">Actual %</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase">Cash Wallet</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase">Invested</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase">Value Live</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase">P/L Unreal.</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase">P/L Real.</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase">P/L Total</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-neutral-500 uppercase">ROI</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {filteredRows.map((row) => (
                    <WalletTableRow key={row.key} row={row} allWallets={allWallets} onReload={load} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="mt-4 text-xs text-neutral-400">
        💡 <strong>Tip:</strong> questa vista mostra root, cash reserve e sub-wallet nello stesso elenco; usa i filtri rapidi per isolare subito la sezione che ti serve.
      </div>
    </div>
  )
}
