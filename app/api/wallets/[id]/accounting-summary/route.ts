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

type LotState = {
  qty: number
  cost_usd: number
  realized_usd: number
}

const STABLES = new Set(['USD', 'USDT', 'USDC', 'DAI', 'EUR'])

function n(x: any) {
  const v = Number(x)
  return Number.isFinite(v) ? v : 0
}

function avgCost(s: LotState) {
  return s.qty > 0 ? s.cost_usd / s.qty : 0
}

// Converte una fee in USD usando avg cost del ticker fee se possibile.
// (per stable = 1)
function feeToUsd(fees: number, feesCurrency: string, state: Map<string, LotState>) {
  if (!fees || fees <= 0) return 0
  if (STABLES.has(feesCurrency)) return fees
  const st = state.get(feesCurrency)
  if (!st || st.qty <= 0) return 0
  return fees * avgCost(st)
}

/**
 * Motore contabile (AVG) con SWAP come:
 * - rimuove qty dal "paidTicker" usando avg cost => costRemovedUsd
 * - aggiunge qty al "recvTicker" con lo stesso costRemovedUsd (+ feeUsd)
 * - realized P/L dello swap = 0 (perché lo consideriamo "scambio" a costo)
 */
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
    s.realized_usd += (proceedsUsd - costBasis)
  }

  const removeAtCost = (ticker: string, qty: number) => {
    const s = get(ticker)
    const a = avgCost(s)
    const costBasis = qty * a
    s.qty -= qty
    s.cost_usd -= costBasis
    return costBasis
  }

  // IMPORTANT: ordine cronologico
  const txs = [...transactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  for (const tx of txs) {
    const action = tx.action
    const ticker = (tx.ticker || '').toUpperCase()
    const qty = n(tx.quantity)
    const price = n(tx.price)
    const priceCur = (tx.price_currency || 'USDT').toUpperCase()
    const fees = n(tx.fees)
    const feesCur = (tx.fees_currency || 'USDT').toUpperCase()

    if (action === 'AIRDROP') {
      // qty gratis, cost 0
      buy(ticker, qty, 0)
      continue
    }

    if (action === 'DEPOSIT') {
      // per stable: cost = qty (1:1). per non-stable: cost 0 (finché non hai prezzi affidabili)
      const costUsd = STABLES.has(ticker) ? qty : 0
      buy(ticker, qty, costUsd)
      continue
    }

    if (action === 'WITHDRAWAL') {
      // rimuoviamo a costo (non realizziamo P/L qui)
      removeAtCost(ticker, qty)
      continue
    }

    if (action === 'BUY') {
      // supportiamo BUY solo se price_currency è stable (MVP coerente)
      if (!STABLES.has(priceCur)) {
        // non sappiamo valutarlo in USD => lo ignoriamo nel costo (ma potremmo gestire in futuro)
        buy(ticker, qty, 0)
        continue
      }
      const feeUsd = feeToUsd(fees, feesCur, state)
      const costUsd = qty * price + feeUsd
      buy(ticker, qty, costUsd)
      continue
    }

    if (action === 'SELL') {
      // supportiamo SELL solo se price_currency è stable (MVP coerente)
      if (!STABLES.has(priceCur)) {
        // non sappiamo valorizzarlo in USD => rimuoviamo a costo (P/L = 0)
        removeAtCost(ticker, qty)
        continue
      }
      const feeUsd = feeToUsd(fees, feesCur, state)
      const proceedsUsd = qty * price - feeUsd
      sellAtPrice(ticker, qty, proceedsUsd)
      continue
    }

    if (action === 'SWAP') {
      // Canonico:
      // recvTicker = to_ticker (o ticker)
      // paidTicker = from_ticker (o price_currency)
      // recvQty = tx.quantity
      // paidQty = tx.quantity * tx.price
      const recvTicker = (tx.to_ticker || tx.ticker || '').toUpperCase()
      const paidTicker = (tx.from_ticker || tx.price_currency || '').toUpperCase()

      const recvQty = qty
      const paidQty = qty * price

      if (!recvTicker || !paidTicker || recvQty <= 0 || paidQty <= 0) {
        continue
      }

      // 1) rimuovo dal paidTicker usando avg cost => ottengo costRemovedUsd
      const costRemovedUsd = removeAtCost(paidTicker, paidQty)

      // 2) fees in USD (se fee è in stable o se abbiamo avg cost del fee token)
      const feeUsd = feeToUsd(fees, feesCur, state)

      // 3) aggiungo al recvTicker lo stesso costo (trasferito) + feeUsd
      buy(recvTicker, recvQty, costRemovedUsd + feeUsd)

      // 4) realized dello swap = 0 (trasferimento cost basis)
      continue
    }
  }

  // output positions
  const positions = Array.from(state.entries())
    .map(([t, s]) => ({
      ticker: t,
      qty_open: s.qty,
      avg_cost: s.qty > 0 ? s.cost_usd / s.qty : null,
      invested_open: s.qty > 0 ? s.cost_usd : 0,
      pl_realized: s.realized_usd,
    }))
    // mostriamo tickers utili
    .filter((p) => Math.abs(p.qty_open) > 1e-12 || Math.abs(p.pl_realized) > 1e-9 || Math.abs(p.invested_open) > 1e-9)

  const invested_open_total = positions
    .filter((p) => !STABLES.has(p.ticker) && (p.qty_open ?? 0) > 0)
    .reduce((a, p) => a + (p.invested_open || 0), 0)

  const pl_realized_total = positions.reduce((a, p) => a + (p.pl_realized || 0), 0)

  return { positions, invested_open_total, pl_realized_total }
}

export async function GET(_: Request, ctx: { params: { id: string } }) {
  const walletId = ctx.params.id
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // wallet
  const { data: wallet, error: wErr } = await supabase
    .from('wallets')
    .select('id,name,parent_wallet_id')
    .eq('id', walletId)
    .eq('user_id', user.id)
    .single()

  if (wErr) return NextResponse.json({ error: wErr.message }, { status: 500 })
  if (!wallet) return NextResponse.json({ error: 'Wallet not found' }, { status: 404 })

  // root (minimo: risaliamo finché parent null)
  let rootId = wallet.id
  let current: any = wallet
  while (current?.parent_wallet_id) {
    const { data: parent } = await supabase
      .from('wallets')
      .select('id,name,parent_wallet_id')
      .eq('id', current.parent_wallet_id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!parent) break
    current = parent
    rootId = parent.id
  }

  // deposits root (in USD/USDT/USDC ecc): per ora usiamo amount "quantity" quando ticker è stable
  const { data: rootTxs } = await supabase
    .from('transactions')
    .select('action,ticker,quantity')
    .eq('user_id', user.id)
    .eq('wallet_id', rootId)

  const depositsRoot = (rootTxs || []).reduce((sum, t: any) => {
    const a = String(t.action || '').toUpperCase()
    const tk = String(t.ticker || '').toUpperCase()
    const q = n(t.quantity)
    if (!STABLES.has(tk)) return sum
    if (a === 'DEPOSIT') return sum + q
    if (a === 'WITHDRAWAL') return sum - q
    return sum
  }, 0)

  // settings target%
  const { data: settingsRow } = await supabase
    .from('wallet_settings')
    .select('target_pct')
    .eq('user_id', user.id)
    .eq('wallet_id', walletId)
    .maybeSingle()

  const targetPct = n(settingsRow?.target_pct)

  // transactions wallet (qui includiamo anche SWAP e tutto)
  const { data: txs, error: tErr } = await supabase
    .from('transactions')
    .select('id,date,action,ticker,quantity,price,price_currency,fees,fees_currency,wallet_id,from_ticker,to_ticker')
    .eq('user_id', user.id)
    .eq('wallet_id', walletId)

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })

  const { positions, invested_open_total, pl_realized_total } = computeAccounting((txs || []) as Tx[])

  const budget = depositsRoot * (targetPct / 100)
  const cash = budget - invested_open_total + pl_realized_total

  return NextResponse.json({
    wallet: { id: wallet.id, name: wallet.name },
    root: { id: rootId, deposits: depositsRoot },
    settings: { target_pct: targetPct },
    summary: {
      budget,
      invested_open: invested_open_total,
      pl_realized: pl_realized_total,
      cash,
    },
    positions,
  })
}
