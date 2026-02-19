import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const STABLES = new Set(['USD', 'USDT', 'USDC', 'DAI', 'EUR'])

function n(x: any) {
  const v = Number(x)
  return Number.isFinite(v) ? v : 0
}

function daysBetween(a: string, b: string) {
  const ms = new Date(b).getTime() - new Date(a).getTime()
  return Math.round(ms / (1000 * 60 * 60 * 24))
}

type RawTx = {
  id: string; date: string; action: string; ticker: string
  quantity: number; price: number; price_currency: string
  fees: number; fees_currency: string; wallet_id: string
  wallet_name: string | null; from_ticker: string | null
  to_ticker: string | null; notes: string | null
  direction: string | null; leverage: number | null
}

type Direction = 'LONG' | 'SHORT'

export type ClosedPositionRow = {
  id: string; ticker: string; wallet_id: string; wallet_name: string | null
  direction: string; action: string; qty_sold: number
  entry_price: number; exit_price: number; invested_cost: number
  proceeds: number; fees_sell: number; pl_usd: number; pl_pct: number
  date_open: string | null; date_close: string; holding_days: number | null
  qty_remaining: number; status: 'CLOSED' | 'PARTIAL'
  notes: string | null; leverage: number | null; exchange: string | null
}

function side(tx: RawTx): Direction {
  return String(tx.direction || 'LONG').toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG'
}

function marginNotional(rawNotionalUsd: number, leverage: number | null | undefined) {
  const lev = Number(leverage)
  if (Number.isFinite(lev) && lev > 1) return rawNotionalUsd / lev
  return rawNotionalUsd
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: rawTxs, error } = await supabase
    .from('transactions')
    .select(`id,date,action,ticker,quantity,price,price_currency,fees,fees_currency,wallet_id,from_ticker,to_ticker,notes,direction,leverage,wallets!wallet_id(name)`)
    .eq('user_id', user.id)
    .order('date', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const txs: RawTx[] = (rawTxs || []).map((t: any) => ({
    ...t, wallet_name: t.wallets?.name ?? null, wallets: undefined,
  }))

  type Lot = {
    qty: number
    cost_notional_usd: number
    cost_margin_usd: number
    first_open_date: string | null
    leverage: number | null
    direction: Direction
    short_open_action: 'BUY' | 'SELL' | null
  }
  const lots = new Map<string, Lot>()
  const lotKey = (wid: string, tk: string, direction: Direction) =>
    `${wid}::${tk.toUpperCase()}::${direction}`
  const getLot = (wid: string, tk: string, direction: Direction): Lot => {
    const k = lotKey(wid, tk, direction)
    if (!lots.has(k)) {
      lots.set(k, {
        qty: 0,
        cost_notional_usd: 0,
        cost_margin_usd: 0,
        first_open_date: null,
        leverage: null,
        direction,
        short_open_action: null,
      })
    }
    return lots.get(k)!
  }

  const closedPositions: ClosedPositionRow[] = []

  const pushClose = (
    tx: RawTx, ticker: string, lot: Lot,
    qtyClose: number, closeNotionalUsd: number, feesUsd: number
  ) => {
    const avgNotional = lot.qty > 0 ? lot.cost_notional_usd / lot.qty : 0
    const avgMargin = lot.qty > 0 ? lot.cost_margin_usd / lot.qty : 0
    const notionalBasis = qtyClose * avgNotional
    const marginBasis = qtyClose * avgMargin
    const proceeds = lot.direction === 'SHORT'
      ? notionalBasis
      : closeNotionalUsd
    const closeCost = lot.direction === 'SHORT'
      ? closeNotionalUsd
      : notionalBasis
    const plUsd = proceeds - closeCost
    const plPct = marginBasis > 0 ? (plUsd / marginBasis) * 100 : 0
    lot.qty -= qtyClose
    lot.cost_notional_usd -= notionalBasis
    lot.cost_margin_usd -= marginBasis
    const holdingDays = lot.first_open_date ? daysBetween(lot.first_open_date, tx.date) : null
    closedPositions.push({
      id: tx.id, ticker, wallet_id: tx.wallet_id, wallet_name: tx.wallet_name,
      direction: lot.direction, action: tx.action.toUpperCase(),
      qty_sold: qtyClose,
      entry_price: qtyClose > 0 ? notionalBasis / qtyClose : 0,
      exit_price: qtyClose > 0 ? closeNotionalUsd / qtyClose : 0,
      invested_cost: marginBasis, proceeds, fees_sell: feesUsd,
      pl_usd: plUsd, pl_pct: plPct,
      date_open: lot.first_open_date, date_close: tx.date, holding_days: holdingDays,
      qty_remaining: lot.qty, status: lot.qty <= 1e-9 ? 'CLOSED' : 'PARTIAL',
      notes: tx.notes, leverage: lot.leverage ?? tx.leverage ?? null, exchange: null,
    })
    if (lot.qty <= 1e-9) lot.short_open_action = null
  }

  for (const tx of txs) {
    const action = tx.action.toUpperCase()
    const ticker = tx.ticker.toUpperCase()
    const priceCur = (tx.price_currency || 'USDT').toUpperCase()
    const qty = n(tx.quantity)
    const price = n(tx.price)
    const fees = n(tx.fees)
    const feesCur = (tx.fees_currency || 'USDT').toUpperCase()
    const feesUsd = STABLES.has(feesCur) ? fees : 0
    const wid = tx.wallet_id
    const direction = side(tx)

    if (action === 'DEPOSIT') {
      if (STABLES.has(ticker)) {
        const lot = getLot(wid, ticker, 'LONG')
        lot.qty += qty
        lot.cost_notional_usd += qty
        lot.cost_margin_usd += qty
        if (!lot.first_open_date) lot.first_open_date = tx.date
      }
      continue
    }

    if (action === 'AIRDROP') {
      if (!STABLES.has(ticker)) {
        const lot = getLot(wid, ticker, 'LONG')
        lot.qty += qty
        // Airdrop is free: zero cost basis by design.
        lot.cost_notional_usd += 0
        lot.cost_margin_usd += 0
        if (!lot.first_open_date) lot.first_open_date = tx.date
      }
      continue
    }

    if (action === 'WITHDRAWAL') continue

    if (action === 'BUY') {
      if (!STABLES.has(priceCur)) continue
      const lot = getLot(wid, ticker, direction)
      if (direction === 'SHORT') {
        const shortOpenAction = lot.short_open_action || (lot.qty > 1e-9 ? 'SELL' : null)
        if (shortOpenAction === 'BUY' || (shortOpenAction == null && lot.qty <= 1e-9)) {
          // Convenzione alternativa: BUY apre short, SELL chiude short
          const notional = qty * price + feesUsd
          const margin = marginNotional(qty * price, tx.leverage) + feesUsd
          lot.qty += qty
          lot.cost_notional_usd += notional
          lot.cost_margin_usd += margin
          lot.short_open_action = 'BUY'
          if (!lot.first_open_date) lot.first_open_date = tx.date
          if (tx.leverage != null && Number(tx.leverage) > 1) lot.leverage = Number(tx.leverage)
        } else {
          // Convenzione classica: SELL apre short, BUY chiude short
          if (lot.qty <= 1e-9) continue
          const qtyClose = Math.min(qty, lot.qty)
          const closeNotionalUsd = qtyClose * price + feesUsd
          pushClose(tx, ticker, lot, qtyClose, closeNotionalUsd, feesUsd)
        }
      } else {
        const notional = qty * price + feesUsd
        const margin = marginNotional(qty * price, tx.leverage) + feesUsd
        lot.qty += qty
        lot.cost_notional_usd += notional
        lot.cost_margin_usd += margin
        if (!lot.first_open_date) lot.first_open_date = tx.date
        if (tx.leverage != null && Number(tx.leverage) > 1) lot.leverage = Number(tx.leverage)
      }
      continue
    }

    if (action === 'SELL') {
      if (!STABLES.has(priceCur)) continue
      const lot = getLot(wid, ticker, direction)
      if (direction === 'SHORT') {
        const shortOpenAction = lot.short_open_action || (lot.qty > 1e-9 ? 'SELL' : null)
        if (shortOpenAction === 'BUY') {
          // Convenzione alternativa: BUY apre short, SELL chiude short
          if (lot.qty <= 1e-9) continue
          const qtyClose = Math.min(qty, lot.qty)
          const closeNotionalUsd = qtyClose * price - feesUsd
          pushClose(tx, ticker, lot, qtyClose, closeNotionalUsd, feesUsd)
        } else {
          // Convenzione classica: SELL apre short, BUY chiude short
          const openProceeds = qty * price - feesUsd
          const margin = marginNotional(qty * price, tx.leverage) + feesUsd
          lot.qty += qty
          lot.cost_notional_usd += openProceeds
          lot.cost_margin_usd += margin
          lot.short_open_action = 'SELL'
          if (!lot.first_open_date) lot.first_open_date = tx.date
          if (tx.leverage != null && Number(tx.leverage) > 1) lot.leverage = Number(tx.leverage)
        }
      } else {
        if (lot.qty <= 1e-9) continue
        const qtyClose = Math.min(qty, lot.qty)
        const closeNotionalUsd = qtyClose * price - feesUsd
        pushClose(tx, ticker, lot, qtyClose, closeNotionalUsd, feesUsd)
      }
      continue
    }

    if (action === 'SWAP') {
      // paidTicker = ceduto (from_ticker), recvTicker = ricevuto (to_ticker o ticker)
      // qty = quantità ricevuta, price = tasso => paidQty = qty * price = quantità ceduta
      const paidTicker = (tx.from_ticker || priceCur).toUpperCase()
      const recvTicker = (tx.to_ticker || ticker).toUpperCase()
      const paidQty = qty * price

      if (STABLES.has(paidTicker)) {
        // ── stable→crypto: apertura posizione sul recvTicker ──
        const lot = getLot(wid, recvTicker, 'LONG')
        lot.qty += qty
        lot.cost_notional_usd += paidQty + feesUsd
        lot.cost_margin_usd += paidQty + feesUsd
        if (!lot.first_open_date) lot.first_open_date = tx.date
        lot.leverage = null

      } else if (STABLES.has(recvTicker)) {
        // ── crypto→stable: chiusura posizione del paidTicker ──
        const lot = getLot(wid, paidTicker, 'LONG')
        if (lot.qty <= 1e-9) continue
        const qtyClose = Math.min(paidQty, lot.qty)
        // qty = stable ricevuti (es. 500 USDT)
        const closeNotionalUsd = qty - feesUsd
        pushClose(tx, paidTicker, lot, qtyClose, closeNotionalUsd, feesUsd)

      } else {
        // ── crypto→crypto: rotazione (es. ETH→SOL) ──
        // Chiudo il paidTicker al suo avg cost => trasferisco il costo al recvTicker
        const paidLot = getLot(wid, paidTicker, 'LONG')
        const recvLot = getLot(wid, recvTicker, 'LONG')
        const qtyPaidClose = paidLot.qty > 0 ? Math.min(paidQty, paidLot.qty) : paidQty
        const avgCostNotional = paidLot.qty > 0 ? paidLot.cost_notional_usd / paidLot.qty : 0
        const avgCostMargin = paidLot.qty > 0 ? paidLot.cost_margin_usd / paidLot.qty : 0
        const costTransferredNotional = qtyPaidClose * avgCostNotional
        const costTransferredMargin = qtyPaidClose * avgCostMargin

        if (paidLot.qty > 0) {
          paidLot.qty -= qtyPaidClose
          paidLot.cost_notional_usd -= costTransferredNotional
          paidLot.cost_margin_usd -= costTransferredMargin
        }

        // Apro recvTicker con il costo trasferito
        recvLot.qty += qty
        recvLot.cost_notional_usd += costTransferredNotional + feesUsd
        recvLot.cost_margin_usd += costTransferredMargin + feesUsd
        if (!recvLot.first_open_date) recvLot.first_open_date = tx.date
        // P/L = 0 per rotazione crypto→crypto, non genero closed position
      }
      continue
    }
  }

  closedPositions.sort((a, b) =>
    new Date(b.date_close).getTime() - new Date(a.date_close).getTime()
  )

  const totalPlUsd = closedPositions.reduce((s, p) => s + p.pl_usd, 0)
  const totalInvested = closedPositions.reduce((s, p) => s + p.invested_cost, 0)
  const winners = closedPositions.filter(p => p.pl_usd > 0).length
  const losers = closedPositions.filter(p => p.pl_usd < 0).length

  return NextResponse.json({
    positions: closedPositions,
    summary: {
      count: closedPositions.length,
      total_pl_usd: totalPlUsd,
      total_invested: totalInvested,
      total_pl_pct: totalInvested > 0 ? (totalPlUsd / totalInvested) * 100 : 0,
      winners, losers,
      win_rate: closedPositions.length > 0 ? (winners / closedPositions.length) * 100 : 0,
    },
  })
}
