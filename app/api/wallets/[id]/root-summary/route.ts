import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type Tx = {
  id: string
  date: string
  action: 'BUY' | 'SELL' | 'DEPOSIT' | 'WITHDRAWAL' | 'SWAP' | 'AIRDROP'
  ticker: string
  quantity: number
  price: number
  price_currency: string
  fees: number
  fees_currency: string
  wallet_id: string | null
  from_ticker: string | null
  to_ticker: string | null
}

type LotState = { qty: number; cost_usd: number; realized_usd: number }

const STABLES = new Set(['USD', 'USDT', 'USDC', 'DAI', 'EUR'])

function n(x: any) {
  const v = Number(x)
  return Number.isFinite(v) ? v : 0
}

function avgCost(s: LotState) {
  return s.qty > 0 ? s.cost_usd / s.qty : 0
}

function estimateFeeUsdFromTx(tx: Tx) {
  const fees = n(tx.fees)
  if (!fees || fees <= 0) return 0
  const feesCur = String(tx.fees_currency || '').toUpperCase()
  if (STABLES.has(feesCur)) return fees

  const price = n(tx.price)
  const priceCur = String(tx.price_currency || '').toUpperCase()
  const ticker = String(tx.ticker || '').toUpperCase()
  const fromTicker = String(tx.from_ticker || '').toUpperCase()
  if (price > 0 && STABLES.has(priceCur) && (feesCur === ticker || feesCur === fromTicker)) {
    return fees * price
  }
  return 0
}

function feeToUsd(
  fees: number,
  feesCurrency: string,
  state: Map<string, LotState>,
  fallbackPriceUsd?: number
) {
  if (!fees || fees <= 0) return 0
  const cur = String(feesCurrency || '').toUpperCase()
  if (STABLES.has(cur)) return fees

  const st = state.get(cur)
  if (st && st.qty > 0) return fees * avgCost(st)

  if (Number.isFinite(fallbackPriceUsd) && (fallbackPriceUsd as number) > 0) {
    return fees * (fallbackPriceUsd as number)
  }

  return 0
}

function computeAccounting(transactions: Tx[]) {
  const state = new Map<string, LotState>()

  const get = (ticker: string) => {
    const t = ticker.toUpperCase()
    if (!state.has(t)) state.set(t, { qty: 0, cost_usd: 0, realized_usd: 0 })
    return state.get(t)!
  }

  const buy = (ticker: string, qty: number, costUsd: number) => {
    const s = get(ticker)
    s.qty += qty
    s.cost_usd += costUsd
  }

  const sellAtPrice = (ticker: string, qty: number, proceedsUsd: number) => {
    const s = get(ticker)
    const a = avgCost(s)
    const costBasis = qty * a
    s.qty -= qty
    s.cost_usd -= costBasis
    s.realized_usd += proceedsUsd - costBasis
  }

  const removeAtCost = (ticker: string, qty: number) => {
    const s = get(ticker)
    const a = avgCost(s)
    const costBasis = qty * a
    s.qty -= qty
    s.cost_usd -= costBasis
    return costBasis
  }

  const txs = [...transactions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  )

  for (const tx of txs) {
    const action = tx.action
    const ticker = (tx.ticker || '').toUpperCase()
    const qty = n(tx.quantity)
    const price = n(tx.price)
    const priceCur = (tx.price_currency || 'USDT').toUpperCase()
    const fees = n(tx.fees)
    const feesCur = (tx.fees_currency || 'USDT').toUpperCase()

    if (action === 'AIRDROP') { buy(ticker, qty, 0); continue }

    if (action === 'DEPOSIT') {
      buy(ticker, qty, STABLES.has(ticker) ? qty : 0)
      continue
    }

    if (action === 'WITHDRAWAL') { removeAtCost(ticker, qty); continue }

    if (action === 'BUY') {
      if (!STABLES.has(priceCur)) { buy(ticker, qty, 0); continue }
      buy(ticker, qty, qty * price + feeToUsd(fees, feesCur, state, STABLES.has(priceCur) ? price : undefined))
      continue
    }

    if (action === 'SELL') {
      if (!STABLES.has(priceCur)) { removeAtCost(ticker, qty); continue }
      sellAtPrice(ticker, qty, qty * price - feeToUsd(fees, feesCur, state, STABLES.has(priceCur) ? price : undefined))
      continue
    }

    if (action === 'SWAP') {
      const recvTicker = (tx.to_ticker || tx.ticker || '').toUpperCase()
      const paidTicker = (tx.from_ticker || tx.price_currency || '').toUpperCase()
      const recvQty = qty
      const paidQty = qty * price
      if (!recvTicker || !paidTicker || recvQty <= 0 || paidQty <= 0) continue

      let costRemovedUsd: number
      if (STABLES.has(paidTicker)) {
        costRemovedUsd = paidQty
        const ps = state.get(paidTicker)
        if (ps && ps.qty >= paidQty) { ps.qty -= paidQty; ps.cost_usd -= paidQty }
      } else {
        const ps = get(paidTicker)
        costRemovedUsd = ps.qty > 0 ? removeAtCost(paidTicker, Math.min(paidQty, ps.qty)) : paidQty
      }

      buy(recvTicker, recvQty, costRemovedUsd + feeToUsd(fees, feesCur, state, STABLES.has(priceCur) ? price : undefined))
      continue
    }
  }

  const positions = Array.from(state.entries())
    .map(([t, s]) => ({
      ticker: t,
      qty_open: s.qty,
      invested_open: s.qty > 0 ? s.cost_usd : 0,
      pl_realized: s.realized_usd,
    }))
    .filter(p => Math.abs(p.qty_open) > 1e-12 || Math.abs(p.pl_realized) > 1e-9)

  const invested_open_total = positions
    .filter(p => !STABLES.has(p.ticker) && p.qty_open > 0)
    .reduce((a, p) => a + p.invested_open, 0)

  const pl_realized_total = positions.reduce((a, p) => a + p.pl_realized, 0)

  return { invested_open_total, pl_realized_total }
}

export async function GET(_: Request, ctx: { params: { id: string } }) {
  const rootId = ctx.params.id
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verifica che il wallet esista e sia una root (parent_wallet_id = null)
  const { data: rootWallet, error: rErr } = await supabase
    .from('wallets')
    .select('id,name,parent_wallet_id')
    .eq('id', rootId)
    .eq('user_id', user.id)
    .single()

  if (rErr || !rootWallet) return NextResponse.json({ error: 'Wallet not found' }, { status: 404 })
  if (rootWallet.parent_wallet_id !== null)
    return NextResponse.json({ error: 'Not a root wallet' }, { status: 400 })

  // Depositi / prelievi della root
  const { data: rootTxs } = await supabase
    .from('transactions')
    .select('action,ticker,quantity,fees,fees_currency')
    .eq('user_id', user.id)
    .eq('wallet_id', rootId)

  const depositsRoot = (rootTxs || []).reduce((sum, t: any) => {
    const a = String(t.action || '').toUpperCase()
    const tk = String(t.ticker || '').toUpperCase()
    const q = n(t.quantity)
    const fees = n(t.fees)
    const feesCur = String(t.fees_currency || '').toUpperCase()
    if (!STABLES.has(tk)) return sum
    if (a === 'DEPOSIT') return sum + q
    if (a === 'WITHDRAWAL') {
      let next = sum - q
      if (STABLES.has(feesCur)) next -= fees
      return next
    }
    return sum
  }, 0)
  const rootFeesTotal = (rootTxs || []).reduce((sum, t: any) => {
    const fees = n(t.fees)
    const feesCur = String(t.fees_currency || '').toUpperCase()
    if (fees <= 0) return sum
    if (STABLES.has(feesCur)) return sum + fees
    return sum
  }, 0)

  // Tutti i subwallet figli diretti di questa root
  const { data: subwallets } = await supabase
    .from('wallets')
    .select('id,name,sort_order')
    .eq('user_id', user.id)
    .eq('parent_wallet_id', rootId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (!subwallets || subwallets.length === 0) {
    return NextResponse.json({
      root: { id: rootId, name: rootWallet.name, deposits: depositsRoot },
      subwallets: [],
    })
  }

  // Per ogni subwallet: carico le sue transazioni e calcolo gli aggregati
  const allSubIds = subwallets.map(s => s.id)

  const { data: allTxs } = await supabase
    .from('transactions')
    .select('id,date,action,ticker,quantity,price,price_currency,fees,fees_currency,wallet_id,from_ticker,to_ticker')
    .eq('user_id', user.id)
    .in('wallet_id', allSubIds)

  // Raggruppa transazioni per wallet_id
  const txsByWallet = new Map<string, Tx[]>()
  for (const tx of allTxs || []) {
    const wid = tx.wallet_id!
    if (!txsByWallet.has(wid)) txsByWallet.set(wid, [])
    txsByWallet.get(wid)!.push(tx as Tx)
  }

  // Settings target% per ogni subwallet
  const { data: settingsRows } = await supabase
    .from('wallet_settings')
    .select('wallet_id,target_pct')
    .eq('user_id', user.id)
    .in('wallet_id', allSubIds)

  const settingsMap = new Map<string, number>()
  for (const s of settingsRows || []) {
    settingsMap.set(s.wallet_id, n(s.target_pct))
  }

  // Calcola aggregati per ogni subwallet
  const subwalletRows = subwallets.map(sw => {
    const txs = txsByWallet.get(sw.id) || []
    const { invested_open_total, pl_realized_total } = computeAccounting(txs)
    const fees_total = txs.reduce((sum, tx) => sum + estimateFeeUsdFromTx(tx), 0)
    const targetPct = settingsMap.get(sw.id) ?? 0
    const budget = depositsRoot * (targetPct / 100)
    const cash = budget - invested_open_total + pl_realized_total

    return {
      id: sw.id,
      name: sw.name,
      target_pct: targetPct,
      budget,
      invested_open: invested_open_total,
      pl_realized: pl_realized_total,
      pl_unrealized: 0, // placeholder: sarà live quando collegheremo prezzi
      value_live: null, // placeholder
      cash,
      fees_total,
      tx_count: txs.length,
    }
  })

  // Totali aggregati della root
  const totalInvested = subwalletRows.reduce((s, r) => s + r.invested_open, 0)
  const totalPlRealized = subwalletRows.reduce((s, r) => s + r.pl_realized, 0)
  const totalFees = rootFeesTotal + subwalletRows.reduce((s, r) => s + (r.fees_total || 0), 0)
  const totalCash = depositsRoot - totalInvested + totalPlRealized

  return NextResponse.json({
    root: {
      id: rootId,
      name: rootWallet.name,
      deposits: depositsRoot,
      invested_open: totalInvested,
      pl_realized: totalPlRealized,
      fees_total: totalFees,
      cash: totalCash,
    },
    subwallets: subwalletRows,
  })
}
