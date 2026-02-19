import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { computeLifoAccounting } from '@/lib/accounting/lifo'

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
  direction?: string | null
  leverage?: number | null
}

type LotState = {
  qty: number
  cost_notional_usd: number
  cost_margin_usd: number
  realized_usd: number
  short_open_action: 'BUY' | 'SELL' | null
}

type Direction = 'LONG' | 'SHORT'

const STABLES = new Set(['USD', 'USDT', 'USDC', 'DAI', 'EUR', 'FDUSD', 'TUSD', 'USDP', 'GUSD', 'GBP', 'CHF', 'JPY'])

function n(x: any) {
  const v = Number(x)
  return Number.isFinite(v) ? v : 0
}

function avgCost(s: LotState) {
  return s.qty > 0 ? s.cost_notional_usd / s.qty : 0
}

function avgMargin(s: LotState) {
  return s.qty > 0 ? s.cost_margin_usd / s.qty : 0
}
function normalizeAction(rawAction: any, rawDirection: any): string {
  const action = String(rawAction || '').trim().toUpperCase()
  const direction = String(rawDirection || 'LONG').trim().toUpperCase()
  if (action === 'CLOSE') return direction === 'SHORT' ? 'BUY' : 'SELL'
  if (action === 'OPEN') return direction === 'SHORT' ? 'SELL' : 'BUY'
  return action
}

function feeToUsd(fees: number, feesCurrency: string, state: Map<string, LotState>) {
  if (!fees || fees <= 0) return 0
  if (STABLES.has(feesCurrency)) return fees
  const token = feesCurrency.toUpperCase()
  const longState = state.get(`${token}::LONG`)
  const shortState = state.get(`${token}::SHORT`)
  const qty = (longState?.qty || 0) + (shortState?.qty || 0)
  const notional = (longState?.cost_notional_usd || 0) + (shortState?.cost_notional_usd || 0)
  if (qty <= 0) return 0
  return fees * (notional / qty)
}

function marginNotional(rawNotionalUsd: number, leverage: number | null | undefined) {
  const lev = Number(leverage)
  if (Number.isFinite(lev) && lev > 1) return rawNotionalUsd / lev
  return rawNotionalUsd
}

function estimateFeeUsd(tx: Tx): number {
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

function calculateLedgerCash(txs: Tx[]): number {
  let cash = 0
  for (const tx of txs) {
    const action = normalizeAction(tx.action, tx.direction)
    const ticker = String(tx.ticker || '').toUpperCase()
    const qty = n(tx.quantity)
    const price = n(tx.price)
    const fees = n(tx.fees)
    const priceCur = String(tx.price_currency || 'USDT').toUpperCase()
    const feesCur = String(tx.fees_currency || 'USDT').toUpperCase()
    const lev = Number(tx.leverage)
    const leverageApplied = Number.isFinite(lev) && lev > 1 ? lev : 1

    if (action === 'DEPOSIT' && STABLES.has(ticker)) {
      cash += qty
    } else if (action === 'WITHDRAWAL' && STABLES.has(ticker)) {
      cash -= qty
      if (STABLES.has(feesCur)) cash -= fees
    } else if (action === 'BUY' && STABLES.has(priceCur)) {
      cash -= (qty * price) / leverageApplied
      if (STABLES.has(feesCur)) cash -= fees
    } else if (action === 'SELL' && STABLES.has(priceCur)) {
      cash += (qty * price) / leverageApplied
      if (STABLES.has(feesCur)) cash -= fees
    } else if (action === 'SWAP') {
      const recvTicker = String(tx.to_ticker || ticker).toUpperCase()
      const paidTicker = String(tx.from_ticker || priceCur).toUpperCase()
      const paidQty = qty * price

      if (STABLES.has(paidTicker)) {
        cash -= paidQty
        if (STABLES.has(feesCur)) cash -= fees
      } else if (STABLES.has(recvTicker)) {
        cash += qty
        if (STABLES.has(feesCur)) cash -= fees
      } else {
        if (STABLES.has(feesCur)) cash -= fees
      }
    }
  }
  return cash
}

function computeAccounting(transactions: Tx[]) {
  return computeLifoAccounting(transactions, STABLES)
}

export async function GET(_: Request, ctx: { params: { id: string } }) {
  const walletId = ctx.params.id
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // wallet - READ target_allocation_percent from wallets table
  const { data: wallet, error: wErr } = await supabase
    .from('wallets')
    .select('id,name,parent_wallet_id,target_allocation_percent')
    .eq('id', walletId)
    .eq('user_id', user.id)
    .single()

  if (wErr) return NextResponse.json({ error: wErr.message }, { status: 500 })
  if (!wallet) return NextResponse.json({ error: 'Wallet not found' }, { status: 404 })

  // root
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

  // deposits root
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

  // USE target_allocation_percent from wallets table (not wallet_settings)
  const targetPct = n(wallet.target_allocation_percent)

  // transactions wallet
  const { data: txs, error: tErr } = await supabase
    .from('transactions')
    .select('id,date,action,ticker,quantity,price,price_currency,fees,fees_currency,wallet_id,from_ticker,to_ticker,direction,leverage')
    .eq('user_id', user.id)
    .eq('wallet_id', walletId)

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })

  const txRows = (txs || []) as Tx[]
  const { positions, invested_open_total, pl_realized_total } = computeAccounting(txRows)
  const fees_total = txRows.reduce((sum, tx) => sum + estimateFeeUsd(tx), 0)

  const safeDepositsRoot = Number.isFinite(depositsRoot) ? depositsRoot : 0
  const safeTargetPct = Number.isFinite(targetPct) ? targetPct : 0
  const budget = safeDepositsRoot * (safeTargetPct / 100)
  const cashDirect = calculateLedgerCash(txRows)
  const cashByAllocation = budget - invested_open_total + pl_realized_total

  return NextResponse.json({
    wallet: { id: wallet.id, name: wallet.name },
    root: { id: rootId, name: current?.name, deposits: depositsRoot },
    settings: { target_pct: targetPct },
    summary: {
      budget,
      invested_open: invested_open_total,
      pl_realized: pl_realized_total,
      fees_total,
      cash_balance: cashDirect,
      cash_direct: cashDirect,
      cash_allocated: cashByAllocation,
    },
    positions,
  })
}
