export type Direction = 'LONG' | 'SHORT'

export type TxLike = {
  action?: string | null
  direction?: string | null
  ticker?: string | null
  quantity?: number | null
  price?: number | null
  price_currency?: string | null
  fees?: number | null
  fees_currency?: string | null
  from_ticker?: string | null
  to_ticker?: string | null
  leverage?: number | null
  date?: string | null
}

type Lot = {
  qty: number
  notional_usd: number
  margin_usd: number
}

type StackState = {
  lots: Lot[]
  realized_usd: number
  short_open_action: 'BUY' | 'SELL' | null
}

export type AccountingPosition = {
  ticker: string
  direction: Direction
  short_open_action: 'BUY' | 'SELL' | null
  qty_open: number
  invested_open: number
  notional_open: number
  pl_realized: number
  avg_cost: number | null
}

export type AccountingResult = {
  positions: AccountingPosition[]
  invested_open_total: number
  pl_realized_total: number
}

function n(x: any) {
  const v = Number(x)
  return Number.isFinite(v) ? v : 0
}

export function normalizeAction(rawAction: any, rawDirection: any): string {
  const action = String(rawAction || '').trim().toUpperCase()
  const direction = String(rawDirection || 'LONG').trim().toUpperCase()
  if (action === 'CLOSE') return direction === 'SHORT' ? 'BUY' : 'SELL'
  if (action === 'OPEN') return direction === 'SHORT' ? 'SELL' : 'BUY'
  return action
}

function marginNotional(rawNotionalUsd: number, leverage: number | null | undefined) {
  const lev = Number(leverage)
  if (Number.isFinite(lev) && lev > 1) return rawNotionalUsd / lev
  return rawNotionalUsd
}

function keyOf(ticker: string, direction: Direction) {
  return `${ticker.toUpperCase()}::${direction}`
}

function lotTotals(state: StackState) {
  let qty = 0
  let notional = 0
  let margin = 0
  for (const lot of state.lots) {
    qty += lot.qty
    notional += lot.notional_usd
    margin += lot.margin_usd
  }
  return { qty, notional, margin }
}

function consumeLifo(state: StackState, qty: number) {
  let remaining = qty
  let consumedQty = 0
  let consumedNotional = 0
  let consumedMargin = 0
  while (remaining > 1e-12 && state.lots.length > 0) {
    const idx = state.lots.length - 1
    const lot = state.lots[idx]
    const take = Math.min(remaining, lot.qty)
    const ratio = lot.qty > 0 ? take / lot.qty : 0
    consumedQty += take
    consumedNotional += lot.notional_usd * ratio
    consumedMargin += lot.margin_usd * ratio

    lot.qty -= take
    lot.notional_usd -= lot.notional_usd * ratio
    lot.margin_usd -= lot.margin_usd * ratio
    remaining -= take
    if (lot.qty <= 1e-12) state.lots.pop()
  }
  return { qty: consumedQty, notional_usd: consumedNotional, margin_usd: consumedMargin }
}

function feeToUsd(
  fees: number,
  feesCurrency: string,
  states: Map<string, StackState>,
  stables: Set<string>
) {
  if (!fees || fees <= 0) return 0
  const cur = (feesCurrency || '').toUpperCase()
  if (stables.has(cur)) return fees

  const longState = states.get(keyOf(cur, 'LONG'))
  const shortState = states.get(keyOf(cur, 'SHORT'))
  const longTotals = longState ? lotTotals(longState) : { qty: 0, notional: 0, margin: 0 }
  const shortTotals = shortState ? lotTotals(shortState) : { qty: 0, notional: 0, margin: 0 }
  const qty = longTotals.qty + shortTotals.qty
  const notional = longTotals.notional + shortTotals.notional
  if (qty <= 0) return 0
  return fees * (notional / qty)
}

export function computeLifoAccounting(
  transactions: TxLike[],
  stables: Set<string>
): AccountingResult {
  const states = new Map<string, StackState>()

  const side = (tx: TxLike): Direction =>
    String(tx.direction || 'LONG').toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG'

  const getState = (ticker: string, direction: Direction) => {
    const key = keyOf(ticker, direction)
    if (!states.has(key)) {
      states.set(key, { lots: [], realized_usd: 0, short_open_action: null })
    }
    return states.get(key)!
  }

  const openLong = (ticker: string, qty: number, notionalUsd: number, marginUsd: number) => {
    const s = getState(ticker, 'LONG')
    if (qty <= 0) return
    s.lots.push({ qty, notional_usd: notionalUsd, margin_usd: marginUsd })
  }

  const openShort = (ticker: string, qty: number, entryNotionalUsd: number, marginUsd: number) => {
    const s = getState(ticker, 'SHORT')
    if (qty <= 0) return
    s.lots.push({ qty, notional_usd: entryNotionalUsd, margin_usd: marginUsd })
  }

  const closeLong = (ticker: string, qty: number, proceedsUsd: number) => {
    const s = getState(ticker, 'LONG')
    const consumed = consumeLifo(s, qty)
    if (consumed.qty <= 0) return
    const proceedsPart = qty > 0 ? proceedsUsd * (consumed.qty / qty) : 0
    s.realized_usd += proceedsPart - consumed.notional_usd
  }

  const closeShort = (ticker: string, qty: number, closeNotionalUsd: number) => {
    const s = getState(ticker, 'SHORT')
    const consumed = consumeLifo(s, qty)
    if (consumed.qty <= 0) return
    const closePart = qty > 0 ? closeNotionalUsd * (consumed.qty / qty) : 0
    s.realized_usd += consumed.notional_usd - closePart
    if (lotTotals(s).qty <= 1e-12) s.short_open_action = null
  }

  const removeAtCost = (ticker: string, qty: number, direction: Direction = 'LONG') => {
    const s = getState(ticker, direction)
    return consumeLifo(s, qty)
  }

  const txs = [...transactions].sort(
    (a, b) => new Date(String(a.date || '')).getTime() - new Date(String(b.date || '')).getTime()
  )

  for (const tx of txs) {
    const action = normalizeAction(tx.action, tx.direction)
    const ticker = String(tx.ticker || '').toUpperCase()
    const qty = n(tx.quantity)
    const price = n(tx.price)
    const priceCur = String(tx.price_currency || 'USDT').toUpperCase()
    const fees = n(tx.fees)
    const feesCur = String(tx.fees_currency || 'USDT').toUpperCase()
    const direction = side(tx)

    if (!ticker || (qty <= 0 && action !== 'SWAP')) continue

    if (action === 'AIRDROP') {
      openLong(ticker, qty, 0, 0)
      continue
    }

    if (action === 'DEPOSIT') {
      const costUsd = stables.has(ticker) ? qty : 0
      openLong(ticker, qty, costUsd, costUsd)
      continue
    }

    if (action === 'WITHDRAWAL') {
      removeAtCost(ticker, qty, 'LONG')
      continue
    }

    if (action === 'BUY') {
      if (!stables.has(priceCur)) {
        if (direction === 'SHORT') removeAtCost(ticker, qty, 'SHORT')
        else openLong(ticker, qty, 0, 0)
        continue
      }
      const notionalUsd = qty * price
      const marginUsd = marginNotional(notionalUsd, tx.leverage)
      const feeUsd = feeToUsd(fees, feesCur, states, stables)
      if (direction === 'SHORT') {
        const s = getState(ticker, 'SHORT')
        const total = lotTotals(s).qty
        const mode = s.short_open_action || (total > 1e-12 ? 'SELL' : null)
        if (mode === 'BUY' || mode == null) {
          openShort(ticker, qty, notionalUsd + feeUsd, marginUsd + feeUsd)
          s.short_open_action = 'BUY'
        } else {
          closeShort(ticker, qty, notionalUsd + feeUsd)
        }
      } else {
        openLong(ticker, qty, notionalUsd + feeUsd, marginUsd + feeUsd)
      }
      continue
    }

    if (action === 'SELL') {
      if (!stables.has(priceCur)) {
        if (direction === 'SHORT') openShort(ticker, qty, 0, 0)
        else removeAtCost(ticker, qty, 'LONG')
        continue
      }
      const notionalUsd = qty * price
      const feeUsd = feeToUsd(fees, feesCur, states, stables)
      if (direction === 'SHORT') {
        const s = getState(ticker, 'SHORT')
        const total = lotTotals(s).qty
        const mode = s.short_open_action || (total > 1e-12 ? 'SELL' : null)
        if (mode === 'BUY') {
          closeShort(ticker, qty, notionalUsd - feeUsd)
        } else {
          const marginUsd = marginNotional(notionalUsd, tx.leverage)
          openShort(ticker, qty, notionalUsd - feeUsd, marginUsd + feeUsd)
          s.short_open_action = 'SELL'
        }
      } else {
        closeLong(ticker, qty, notionalUsd - feeUsd)
      }
      continue
    }

    if (action === 'SWAP') {
      const recvTicker = String(tx.to_ticker || tx.ticker || '').toUpperCase()
      const paidTicker = String(tx.from_ticker || tx.price_currency || '').toUpperCase()
      const recvQty = qty
      const paidQty = qty * price
      if (!recvTicker || !paidTicker || recvQty <= 0 || paidQty <= 0) continue
      const feeUsd = feeToUsd(fees, feesCur, states, stables)

      if (stables.has(paidTicker)) {
        openLong(recvTicker, recvQty, paidQty + feeUsd, paidQty + feeUsd)
      } else {
        const removed = removeAtCost(paidTicker, paidQty, 'LONG')
        openLong(recvTicker, recvQty, removed.notional_usd + feeUsd, removed.margin_usd + feeUsd)
      }
      continue
    }
  }

  const positions: AccountingPosition[] = Array.from(states.entries())
    .map(([key, s]) => {
      const [ticker, directionRaw] = key.split('::')
      const totals = lotTotals(s)
      return {
        ticker: ticker || '',
        direction: (directionRaw || 'LONG') as Direction,
        short_open_action: s.short_open_action,
        qty_open: totals.qty,
        invested_open: totals.margin,
        notional_open: totals.notional,
        pl_realized: s.realized_usd,
        avg_cost: totals.qty > 0 ? totals.margin / totals.qty : null,
      }
    })
    .filter((p) => p.ticker && (Math.abs(p.qty_open) > 1e-12 || Math.abs(p.pl_realized) > 1e-9))

  const invested_open_total = positions
    .filter((p) => !stables.has(p.ticker) && p.qty_open > 0)
    .reduce((acc, p) => acc + p.invested_open, 0)

  const pl_realized_total = positions.reduce((acc, p) => acc + p.pl_realized, 0)

  return { positions, invested_open_total, pl_realized_total }
}
