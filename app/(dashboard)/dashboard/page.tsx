'use client'

import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'
import { usePrices } from '@/contexts/PricesContext'
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts'
import { TrendingUp, DollarSign, Wallet, PieChart as PieChartIcon } from 'lucide-react'

type Position = {
  wallet_id: string
  ticker: string
  qty_total: number
  total_cost: number
  value_live: number | null
  pl_unrealized: number | null
}

type TreeNode = {
  id: string
  name: string
  level: number
  parent_id: string | null
  target_allocation: number | null
  actual_allocation: number | null
  total_invested: number
  cash_balance: number
  cash_available?: number
  cash_operational?: number
  total_value_live: number
  pl_unrealized: number
  pl_unrealized_pct: number
  pl_realized: number
  pl_realized_pct: number
  pl_total: number
  pl_total_pct: number
  children: TreeNode[]
  positions: Position[]
}

type GlobalKPIs = {
  total_invested: number
  cash_balance: number
  cash_operational?: number
  total_value_live: number
  global_live_value?: number
  pl_unrealized: number
  pl_realized: number
  pl_total: number
  pl_total_pct: number
}

type KpisTotals = {
  deposits: number
  deposits_gross?: number
  withdrawals_gross?: number
  pl_realized: number
  pl_unrealized: number
  deposits_plus_realized: number
  invested_open: number
  invested_plus_realized: number
  invested_plus_unrealized: number
  balance_live: number
  cash: number
  fees_total: number
}

const DASHBOARD_ROOT_SCOPE = 'CRIPTOVALUTE'

const COLORS = ['#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#6366f1']

const fmtUsd = (v: number | null, decimals = 2) => {
  if (v == null || !Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  const d = abs < 0.01 ? 6 : abs < 1 ? 4 : decimals
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { 
    minimumFractionDigits: d, 
    maximumFractionDigits: d 
  })
}

const fmtUsd2 = (v: number | null) => {
  if (v == null || !Number.isFinite(v)) return '—'
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
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

export default function DashboardPage() {
  const [tree, setTree] = useState<TreeNode[]>([])
  const [global, setGlobal] = useState<GlobalKPIs | null>(null)
  const [kpis, setKpis] = useState<KpisTotals | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const { lastUpdate } = usePrices()

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set('root_name', DASHBOARD_ROOT_SCOPE)
      const [treeRes, kpisRes] = await Promise.all([
        fetch(`/api/portfolio/tree?${params.toString()}`),
        fetch(`/api/portfolio/kpis?${params.toString()}`),
      ])
      const [treeJson, kpisJson] = await Promise.all([treeRes.json(), kpisRes.json()])
      if (!treeRes.ok) throw new Error(treeJson.error || 'Errore caricamento tree')
      if (!kpisRes.ok) throw new Error(kpisJson.error || 'Errore caricamento kpis')

      setTree(treeJson.tree || [])
      setGlobal(treeJson.global || null)
      setKpis(kpisJson.totals || null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])
  useEffect(() => { if (lastUpdate) load() }, [lastUpdate])

  const childCashValue = (child: TreeNode) =>
    child.cash_available ?? child.cash_operational ?? child.cash_balance

  // Prepare chart data
  const allocationData = tree.flatMap(root => {
    return root.children.map((child, idx) => ({
      name: child.name,
      value: child.total_value_live + childCashValue(child),
      cash: childCashValue(child),
      invested: child.total_invested,
      color: COLORS[idx % COLORS.length]
    }))
  }).filter(d => d.value > 0)
  const allocationTotal = allocationData.reduce((sum, item) => sum + item.value, 0)

  const investedForCards = kpis?.invested_open ?? global?.total_invested ?? 0
  const cashForCards = kpis?.cash ?? global?.cash_balance ?? global?.cash_operational ?? 0
  const depositsNetForCards = kpis?.deposits ?? 0
  const plRealizedForCards = kpis?.pl_realized ?? global?.pl_realized ?? 0
  const plUnrealizedForCards = kpis?.pl_unrealized ?? global?.pl_unrealized ?? 0
  const feesTotalForCards = kpis?.fees_total ?? 0
  const investedLiveForCards = kpis?.invested_plus_unrealized ?? (investedForCards + plUnrealizedForCards)
  const totalPortfolioLiveForCards = kpis?.balance_live ?? (cashForCards + investedLiveForCards)
  const cashVsInvestedData =
    cashForCards >= 0
      ? [
          { name: 'Cash', value: cashForCards, color: '#06b6d4' },
          { name: 'Investito', value: Math.max(0, investedLiveForCards), color: '#8b5cf6' },
        ]
      : [
          { name: 'Debito Cash', value: Math.abs(cashForCards), color: '#ef4444' },
          { name: 'Investito', value: Math.max(0, investedLiveForCards), color: '#8b5cf6' },
        ]

  return (
    <div>
      <PageHeader
        title="Dashboard Portfolio"
        subtitle="Panoramica completa del tuo portafoglio"
      />

      {error && (
        <div className="mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-neutral-500">
          <div className="animate-spin text-4xl mb-3">⟳</div>
          <div className="text-sm">Caricamento dati...</div>
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          {global && (
            <div className="mb-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-4">
              {/* Total Portfolio Live */}
              <Card>
                <CardBody className="p-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-sm text-neutral-500 mb-1">Valore Totale Portafogli Live</div>
                      <div className="text-3xl font-bold text-neutral-900">
                        {fmtUsd2(totalPortfolioLiveForCards)}
                      </div>
                      <div className="text-xs text-neutral-400 mt-1">
                        Investito live: {fmtUsd2(investedLiveForCards)} · Cash: {fmtUsd2(cashForCards)}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-purple-100">
                      <DollarSign className="h-6 w-6 text-purple-600" />
                    </div>
                  </div>
                </CardBody>
              </Card>

              {/* Invested */}
              <Card>
                <CardBody className="p-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-sm text-neutral-500 mb-1">Valore Investito</div>
                      <div className="text-3xl font-bold text-neutral-900">
                        {fmtUsd2(investedForCards)}
                      </div>
                      <div className="text-xs text-neutral-400 mt-1">
                        Cost basis open positions
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-neutral-100">
                      <Wallet className="h-6 w-6 text-neutral-600" />
                    </div>
                  </div>
                </CardBody>
              </Card>

              {/* Cash */}
              <Card>
                <CardBody className="p-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-sm text-neutral-500 mb-1">Valore Cash</div>
                      <div className="text-3xl font-bold text-cyan-600">
                        {fmtUsd2(cashForCards)}
                      </div>
                      <div className="text-xs text-neutral-400 mt-1">
                        Liquidita operativa
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-cyan-100">
                      <DollarSign className="h-6 w-6 text-cyan-600" />
                    </div>
                  </div>
                </CardBody>
              </Card>

              {/* Depositi Netti */}
              <Card>
                <CardBody className="p-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-sm text-neutral-500 mb-1">Depositi Netti</div>
                      <div className="text-3xl font-bold text-indigo-600">
                        {fmtUsd2(depositsNetForCards)}
                      </div>
                      <div className="text-xs text-neutral-400 mt-1">
                        Depositi {fmtUsd2(kpis?.deposits_gross ?? 0)} - Prelievi {fmtUsd2(kpis?.withdrawals_gross ?? 0)}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-indigo-100">
                      <Wallet className="h-6 w-6 text-indigo-600" />
                    </div>
                  </div>
                </CardBody>
              </Card>

              {/* P/L Unrealized */}
              <Card>
                <CardBody className="p-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-sm text-neutral-500 mb-1">P/L Unrealized</div>
                      <div className={`text-3xl font-bold ${clsPL(plUnrealizedForCards)}`}>
                        {fmtUsd2(plUnrealizedForCards)}
                      </div>
                      <div className="text-xs text-neutral-400 mt-1">
                        P/L posizioni aperte
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-emerald-100">
                      <TrendingUp className="h-6 w-6 text-emerald-600" />
                    </div>
                  </div>
                </CardBody>
              </Card>

              {/* P/L Realized */}
              <Card>
                <CardBody className="p-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-sm text-neutral-500 mb-1">P/L Realized</div>
                      <div className={`text-3xl font-bold ${clsPL(plRealizedForCards)}`}>
                        {fmtUsd2(plRealizedForCards)}
                      </div>
                      <div className="text-xs text-neutral-400 mt-1">
                        P/L posizioni chiuse
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-amber-100">
                      <Wallet className="h-6 w-6 text-amber-600" />
                    </div>
                  </div>
                </CardBody>
              </Card>

              {/* Fees Totali */}
              <Card>
                <CardBody className="p-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-sm text-neutral-500 mb-1">Fee Totali</div>
                      <div className="text-3xl font-bold text-amber-600">
                        {fmtUsd2(feesTotalForCards)}
                      </div>
                      <div className="text-xs text-neutral-400 mt-1">
                        Commissioni cumulative (stima USD)
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-amber-100">
                      <Wallet className="h-6 w-6 text-amber-600" />
                    </div>
                  </div>
                </CardBody>
              </Card>
            </div>
          )}

          {/* Charts Section */}
          <div className="mb-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Allocation Pie Chart */}
            <Card>
              <CardBody className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <PieChartIcon className="h-5 w-5 text-neutral-600" />
                  <h3 className="text-lg font-semibold text-neutral-900">Allocazione per Wallet</h3>
                </div>
                {allocationData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={allocationData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {allocationData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip 
                        formatter={(value: any) => fmtUsd(value, 0)}
                        contentStyle={{ 
                          background: 'white', 
                          border: '1px solid #e5e7eb',
                          borderRadius: '8px',
                          padding: '8px'
                        }}
                      />
                      <Legend 
                        verticalAlign="bottom" 
                        height={36}
                        formatter={(value, entry: any) => (
                          <span className="text-sm text-neutral-700">
                            {value} ({allocationTotal > 0 ? ((entry.payload.value / allocationTotal) * 100).toFixed(1) : '0.0'}%)
                          </span>
                        )}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[300px] flex items-center justify-center text-neutral-400 text-sm">
                    Nessun dato disponibile
                  </div>
                )}
              </CardBody>
            </Card>

            {/* Cash vs Invested */}
            <Card>
              <CardBody className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <PieChartIcon className="h-5 w-5 text-neutral-600" />
                  <h3 className="text-lg font-semibold text-neutral-900">Cash vs Investito</h3>
                </div>
                {global && (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={cashVsInvestedData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        <Cell fill={cashVsInvestedData[0]?.color || '#06b6d4'} />
                        <Cell fill="#8b5cf6" />
                      </Pie>
                      <Tooltip 
                        formatter={(value: any) => fmtUsd(value, 0)}
                        contentStyle={{ 
                          background: 'white', 
                          border: '1px solid #e5e7eb',
                          borderRadius: '8px',
                          padding: '8px'
                        }}
                      />
                      <Legend 
                        verticalAlign="bottom" 
                        height={36}
                        formatter={(value, entry: any) => (
                          <span className="text-sm text-neutral-700">
                            {value}: {fmtUsd(entry.payload.value, 0)} ({(totalPortfolioLiveForCards > 0 ? ((entry.payload.value / totalPortfolioLiveForCards) * 100) : 0).toFixed(1)}%)
                          </span>
                        )}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardBody>
            </Card>
          </div>

          {/* Wallets Table */}
          <Card>
            <CardBody className="p-0">
              <div className="px-6 py-4 border-b border-neutral-100">
                <h3 className="text-lg font-semibold text-neutral-900">Dettaglio Wallets</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-neutral-50 border-b border-neutral-200">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                        Wallet
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-neutral-500 uppercase tracking-wider">
                        Target %
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-neutral-500 uppercase tracking-wider">
                        Actual %
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-neutral-500 uppercase tracking-wider">
                        Cash Wallet
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-neutral-500 uppercase tracking-wider">
                        Investito
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-neutral-500 uppercase tracking-wider">
                        Valore Live
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-neutral-500 uppercase tracking-wider">
                        P/L Total
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-neutral-500 uppercase tracking-wider">
                        ROI
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-neutral-100">
                    {tree.map(root => (
                      <>
                        {/* Root Wallet */}
                        <tr key={root.id} className="bg-neutral-50 font-semibold">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-neutral-900">{root.name}</span>
                              <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">L{root.level}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-neutral-600">
                            {root.target_allocation != null ? `${root.target_allocation.toFixed(1)}%` : '—'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-neutral-600">
                            —
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium text-cyan-600">
                            {fmtUsd(root.cash_operational ?? root.cash_balance, 0)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium text-neutral-900">
                            {fmtUsd(root.total_invested, 0)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium text-neutral-900">
                            {(root.total_value_live + (root.cash_operational ?? root.cash_balance)) > 0
                              ? fmtUsd(root.total_value_live + (root.cash_operational ?? root.cash_balance), 0)
                              : '—'}
                          </td>
                          <td className={`px-6 py-4 whitespace-nowrap text-right text-sm font-bold ${clsPL(root.pl_total)}`}>
                            {fmtUsd(root.pl_total, 0)}
                          </td>
                          <td className={`px-6 py-4 whitespace-nowrap text-right text-sm font-bold ${clsPL(root.pl_total_pct)}`}>
                            {fmtPct(root.pl_total_pct)}
                          </td>
                        </tr>
                        {/* Child Wallets */}
                        {root.children.map(child => (
                          <tr key={child.id} className="hover:bg-neutral-50">
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center gap-2 pl-6">
                                <span className="text-sm text-neutral-700">{child.name}</span>
                                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">L{child.level}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-neutral-600">
                              <div className="text-right">
                                <div>{child.target_allocation != null ? `${child.target_allocation.toFixed(1)}%` : '—'}</div>
                                {child.target_allocation != null && (root.cash_operational ?? root.cash_balance) > 0 && (
                                  <div className="text-xs text-neutral-400">
                                    {fmtUsd(((root.cash_operational ?? root.cash_balance) * child.target_allocation) / 100, 0)}
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-neutral-600">
                              {child.actual_allocation != null ? `${child.actual_allocation.toFixed(1)}%` : '—'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium text-cyan-600">
                              {fmtUsd(childCashValue(child), 0)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium text-neutral-700">
                              {fmtUsd(child.total_invested, 0)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium text-neutral-700">
                              {(child.total_value_live + childCashValue(child)) > 0
                                ? fmtUsd(child.total_value_live + childCashValue(child), 0)
                                : '—'}
                            </td>
                            <td className={`px-6 py-4 whitespace-nowrap text-right text-sm font-bold ${clsPL(child.pl_total)}`}>
                              {fmtUsd(child.pl_total, 0)}
                            </td>
                            <td className={`px-6 py-4 whitespace-nowrap text-right text-sm font-bold ${clsPL(child.pl_total_pct)}`}>
                              {fmtPct(child.pl_total_pct)}
                            </td>
                          </tr>
                        ))}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}
