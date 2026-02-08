import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type LegKind = 'IN' | 'OUT' | 'FEE'
type Leg = {
  wallet_id: string
  ticker: string
  delta_qty: number
  kind: LegKind
  tx_id: string
}

const EPS = 1e-10

function toUpper(x: any, fallback = ''): string {
  return String(x ?? fallback).trim().toUpperCase()
}

function num(x: any, fallback = 0): number {
  const v = Number(x)
  return Number.isFinite(v) ? v : fallback
}

/**
 * Contract:
 * - wallet_id must exist (but for now we bucket null wallet_id into "UNASSIGNED")
 * - crypto BUY/SELL are swaps vs price_currency
 * - SWAP uses: price = to per 1 from
 * - fee always exists conceptually; leg is created only if fee != 0
 */
function txToLegs(tx: any): Leg[] {
  const action = toUpper(tx.action)
  const ticker = toUpper(tx.ticker)
  const priceCurrency = toUpper(tx.price_currency, 'USDT')
  const feesCurrency = toUpper(tx.fees_currency, priceCurrency)

  const qty = num(tx.quantity)
  const price = num(tx.price)
  const fees = num(tx.fees ?? 0)

  const txId = String(tx.id)
  const walletId = tx.wallet_id ? String(tx.wallet_id) : 'UNASSIGNED'

  const legs: Leg[] = []

  const add = (t: string, delta: number, kind: LegKind) => {
    if (!delta || Math.abs(delta) < 1e-18) return
    legs.push({
      wallet_id: walletId,
      ticker: toUpper(t),
      delta_qty: delta,
      kind,
      tx_id: txId,
    })
  }

  const addFee = () => {
    add(feesCurrency, -fees, 'FEE')
  }

  if (action === 'DEPOSIT') {
    add(ticker, +qty, 'IN')
    addFee()
    return legs
  }

  if (action === 'WITHDRAWAL') {
    add(ticker, -qty, 'OUT')
    addFee()
    return legs
  }

  if (action === 'AIRDROP') {
    add(ticker, +qty, 'IN')
    addFee()
    return legs
  }

  if (action === 'BUY') {
    add(ticker, +qty, 'IN')
    add(priceCurrency, -(qty * price), 'OUT')
    addFee()
    return legs
  }

  if (action === 'SELL') {
    add(ticker, -qty, 'OUT')
    add(priceCurrency, +(qty * price), 'IN')
    addFee()
    return legs
  }

  if (action === 'SWAP') {
    const fromTicker = toUpper(tx.from_ticker)
    const toTicker = toUpper(tx.to_ticker)
    if (!fromTicker || !toTicker) {
      // swap malformato: non generiamo legs (ma lo segnaliamo fuori)
      return legs
    }
    add(fromTicker, -qty, 'OUT')
    add(toTicker, +(qty * price), 'IN') // price = to per 1 from
    addFee()
    return legs
  }

  if (action === 'FEE') {
    // Se già usi righe FEE separate, questa è già una leg
    add(ticker, -qty, 'FEE')
    return legs
  }

  return legs
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const limit = Math.min(parseInt(searchParams.get('limit') || '5000', 10), 20000)
  const includeFeesRows = searchParams.get('include_fee_rows') === '1' // include action='FEE' rows
  const includeUnassigned = searchParams.get('include_unassigned') !== '0' // default true

  // Query: prendiamo tutto (fino a limit) ordinato per data ASC (importante per bilanci progressivi)
  let q = supabase
    .from('transactions')
    .select('*')
    .eq('user_id', user.id)
    .order('date', { ascending: true })
    .limit(limit)

  if (!includeFeesRows) {
    // Se non vuoi considerare righe FEE già separate
    q = q.neq('action', 'FEE')
  }

  const { data: txs, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const balances: Record<string, Record<string, number>> = {}
  const totals: Record<string, number> = {}

  const warnings: Array<{ type: string; tx_id?: string; message: string }> = []
  let legsCount = 0
  let unassignedCount = 0
  let badSwapCount = 0

  for (const tx of txs || []) {
    if (!tx.wallet_id) unassignedCount++

    const legs = txToLegs(tx)

    if (toUpper(tx.action) === 'SWAP') {
      const fromT = toUpper(tx.from_ticker)
      const toT = toUpper(tx.to_ticker)
      if (!fromT || !toT) {
        badSwapCount++
        warnings.push({ type: 'BAD_SWAP', tx_id: String(tx.id), message: 'SWAP missing from_ticker or to_ticker' })
      }
    }

    for (const leg of legs) {
      if (leg.wallet_id === 'UNASSIGNED' && !includeUnassigned) continue

      balances[leg.wallet_id] ||= {}
      balances[leg.wallet_id][leg.ticker] = (balances[leg.wallet_id][leg.ticker] || 0) + leg.delta_qty

      totals[leg.ticker] = (totals[leg.ticker] || 0) + leg.delta_qty

      legsCount++
    }
  }

  // Negative checks per wallet/ticker
  const negatives: Array<{ wallet_id: string; ticker: string; balance: number }> = []
  for (const [wid, byTicker] of Object.entries(balances)) {
    for (const [t, bal] of Object.entries(byTicker)) {
      if (bal < -EPS) negatives.push({ wallet_id: wid, ticker: t, balance: bal })
    }
  }

  if (unassignedCount > 0) {
    warnings.push({
      type: 'UNASSIGNED_WALLET',
      message: `${unassignedCount} transactions have wallet_id = null (bucketed into UNASSIGNED).`,
    })
  }

  return NextResponse.json({
    meta: {
      user_id: user.id,
      tx_count: (txs || []).length,
      legs_count: legsCount,
      limit,
      include_fee_rows: includeFeesRows,
      include_unassigned: includeUnassigned,
      bad_swap_count: badSwapCount,
    },
    balances, // wallet_id -> ticker -> qty
    totals,   // ticker -> qty (global)
    negatives,
    warnings,
  })
}
