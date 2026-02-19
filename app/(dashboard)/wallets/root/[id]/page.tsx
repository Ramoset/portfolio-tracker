'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'

const FONT_STYLE = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,300&family=DM+Mono:wght@400;500&display=swap');
  .root-detail * { font-family: 'DM Sans', sans-serif; }
  .root-detail .mono { font-family: 'DM Mono', monospace; }
`

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number.isFinite(n) ? n : 0)
}
function fmtPct(n: number) { if (!Number.isFinite(n)) return '—'; return `${n.toFixed(2)}%` }
function fmtPctSigned(n: number) { if (!Number.isFinite(n)) return '—'; return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` }
function pct(part: number, total: number) { if (!total) return NaN; return (part / total) * 100 }
function clsPL(v: number) { if (v > 0.001) return 'text-emerald-600'; if (v < -0.001) return 'text-red-500'; return 'text-neutral-500' }

type SubwalletRow = { id: string; name: string; target_pct: number; budget: number; invested_open: number; pl_realized: number; pl_unrealized: number; value_live: number | null; cash: number; fees_total?: number; tx_count: number }
type RootData = { root: { id: string; name: string; deposits: number; invested_open: number; pl_realized: number; fees_total?: number; cash: number }; subwallets: SubwalletRow[] }

function BudgetBar({ used, total }: { used: number; total: number }) {
  const p = total > 0 ? Math.min((used / total) * 100, 100) : 0
  const color = p > 95 ? 'bg-red-400' : p > 75 ? 'bg-amber-400' : 'bg-emerald-400'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 rounded-full bg-neutral-100 overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${p}%` }} />
      </div>
      <span className="mono text-xs text-neutral-400">{fmtPct(p)}</span>
    </div>
  )
}

export default function RootWalletPage({ params }: { params: { id: string } }) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<RootData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/wallets/${params.id}/root-summary`)
      .then(r => r.json())
      .then(json => { if (json.error) setError(json.error); else setData(json) })
      .catch(() => setError('Errore di rete'))
      .finally(() => setLoading(false))
  }, [params.id])

  if (loading) return <div className="root-detail flex items-center gap-2 py-12 text-sm text-neutral-400"><style suppressHydrationWarning>{FONT_STYLE}</style><span className="animate-spin">⟳</span> Caricamento…</div>
  if (error) return <div className="root-detail py-8 text-sm text-red-500"><style suppressHydrationWarning>{FONT_STYLE}</style>Errore: {error}</div>
  if (!data) return null

  const { root, subwallets } = data
  const totalBudgetAllocato = subwallets.reduce((s, w) => s + w.budget, 0)

  return (
    <div className="root-detail">
      <style suppressHydrationWarning>{FONT_STYLE}</style>

      <div className="mb-2 flex items-center gap-2 text-xs text-neutral-400">
        <Link href="/wallets" className="hover:text-neutral-600">Wallets</Link>
        <span>›</span>
        <span className="text-neutral-600 font-medium">{root.name}</span>
      </div>

      <PageHeader title={root.name} subtitle={`Root wallet · ${subwallets.length} subwallet`} />

      <div className="mb-4 grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: 'Depositi Totali', value: fmt(root.deposits), sub: 'Netto withdrawals', color: '' },
          { label: 'Investito (open)', value: fmt(root.invested_open), sub: `${fmtPct(pct(root.invested_open, root.deposits))} dei depositi`, color: '' },
          { label: 'P/L Realizzato', value: fmt(root.pl_realized), sub: `${fmtPctSigned(pct(root.pl_realized, root.deposits))} sui depositi`, color: clsPL(root.pl_realized) },
          { label: 'Fee Totali', value: fmt(Number(root.fees_total || 0)), sub: 'commissioni cumulative', color: 'text-amber-600' },
          { label: 'Cash Contabile', value: fmt(root.cash), sub: `${fmtPct(pct(root.cash, root.deposits))} dei depositi`, color: clsPL(root.cash) },
        ].map((kpi, i) => (
          <Card key={i}><CardBody>
            <div className="text-[11px] font-medium uppercase tracking-wider text-neutral-400 mb-1">{kpi.label}</div>
            <div className={`text-xl font-semibold ${kpi.color || 'text-neutral-800'}`}>{kpi.value}</div>
            <div className={`text-xs mt-1 ${kpi.color || 'text-neutral-400'}`}>{kpi.sub}</div>
          </CardBody></Card>
        ))}
      </div>

      <Card>
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-neutral-700">Subwallet</span>
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-500">{subwallets.length}</span>
          </div>
          <div className="text-[11px] text-neutral-400">
            Budget totale allocato: <span className="mono font-medium text-neutral-600">{fmt(totalBudgetAllocato)}</span> ({fmtPct(pct(totalBudgetAllocato, root.deposits))} dei depositi)
          </div>
        </div>

        {subwallets.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-neutral-300">Nessun subwallet trovato.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 z-10 bg-white border-b border-neutral-100">
                <tr>
                  {['Wallet','Target %','Budget','Investito','Utilizzo Budget','% Depositi','P/L Real.','P/L Unreal.','Valore Live','Cash','Cash %','Tx',''].map((h, i) => (
                    <th key={i} className={`px-4 py-3 text-[10px] font-semibold uppercase tracking-widest whitespace-nowrap ${i === 0 ? 'text-left' : 'text-right'} ${i === 6 ? 'text-emerald-500' : i === 7 || i === 8 ? 'text-sky-400' : 'text-slate-500'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-50">
                {subwallets.map((sw, idx) => (
                  <tr key={sw.id} className={idx % 2 === 0 ? 'bg-white hover:bg-slate-50/60' : 'bg-neutral-50/40 hover:bg-slate-50/60'}>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Link href={`/wallets/${sw.id}`} className="group inline-flex items-center gap-1.5 font-semibold text-neutral-800 hover:text-blue-600 transition-colors">
                        {sw.name}
                        <svg className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right"><span className="mono text-xs text-neutral-500">{sw.target_pct > 0 ? `${sw.target_pct}%` : <span className="text-neutral-300">—</span>}</span></td>
                    <td className="px-4 py-3 text-right"><span className="mono text-neutral-600">{sw.budget > 0 ? fmt(sw.budget) : <span className="text-neutral-300">—</span>}</span></td>
                    <td className="px-4 py-3 text-right"><span className="mono font-medium text-neutral-800">{fmt(sw.invested_open)}</span></td>
                    <td className="px-4 py-3 text-right">{sw.budget > 0 ? <BudgetBar used={sw.invested_open} total={sw.budget} /> : <span className="text-neutral-300 text-xs">—</span>}</td>
                    <td className="px-4 py-3 text-right"><span className="mono text-xs text-neutral-500">{fmtPct(pct(sw.invested_open, root.deposits))}</span></td>
                    <td className="px-4 py-3 text-right"><span className={`mono font-medium ${clsPL(sw.pl_realized)}`}>{fmt(sw.pl_realized)}</span></td>
                    <td className="px-4 py-3 text-right"><span className="text-neutral-300 text-xs mono">—</span></td>
                    <td className="px-4 py-3 text-right"><span className="text-neutral-300 text-xs mono">—</span></td>
                    <td className="px-4 py-3 text-right"><span className={`mono font-medium ${clsPL(sw.cash)}`}>{fmt(sw.cash)}</span></td>
                    <td className="px-4 py-3 text-right"><span className="mono text-xs text-neutral-500">{fmtPct(pct(sw.cash, root.deposits))}</span></td>
                    <td className="px-4 py-3 text-right"><span className="mono text-xs text-neutral-300">{sw.tx_count}</span></td>
                    <td className="px-4 py-3"><Link href={`/wallets/${sw.id}`} className="rounded-lg border border-neutral-200 px-2.5 py-1 text-[11px] font-medium text-neutral-500 hover:border-blue-300 hover:text-blue-600 transition-colors whitespace-nowrap">Dettaglio →</Link></td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-neutral-200 bg-neutral-50">
                <tr>
                  <td className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Totale</td>
                  <td className="px-4 py-3 text-right"><span className="mono text-xs text-neutral-400">{fmtPct(subwallets.reduce((s, w) => s + w.target_pct, 0))}</span></td>
                  <td className="px-4 py-3 text-right"><span className="mono text-sm font-semibold text-neutral-700">{fmt(totalBudgetAllocato)}</span></td>
                  <td className="px-4 py-3 text-right"><span className="mono text-sm font-semibold text-neutral-800">{fmt(root.invested_open)}</span></td>
                  <td className="px-4 py-3 text-right"><BudgetBar used={root.invested_open} total={totalBudgetAllocato} /></td>
                  <td className="px-4 py-3 text-right"><span className="mono text-xs font-semibold text-neutral-600">{fmtPct(pct(root.invested_open, root.deposits))}</span></td>
                  <td className="px-4 py-3 text-right"><span className={`mono text-sm font-semibold ${clsPL(root.pl_realized)}`}>{fmt(root.pl_realized)}</span></td>
                  <td className="px-4 py-3 text-right"><span className="text-neutral-300 text-xs mono">—</span></td>
                  <td className="px-4 py-3 text-right"><span className="text-neutral-300 text-xs mono">—</span></td>
                  <td className="px-4 py-3 text-right"><span className={`mono text-sm font-semibold ${clsPL(root.cash)}`}>{fmt(root.cash)}</span></td>
                  <td className="px-4 py-3 text-right"><span className="mono text-xs font-semibold text-neutral-600">{fmtPct(pct(root.cash, root.deposits))}</span></td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-3 text-xs text-neutral-400">ℹ P/L non realizzato e valore live disponibili dopo collegamento API prezzi. Clicca su un subwallet per vedere i singoli asset.</div>
    </div>
  )
}
