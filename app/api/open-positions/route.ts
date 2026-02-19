import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

type Tx = {
  id: string
  date: string
  action: string
  ticker: string
  quantity: number
  price: number
  price_currency: string
  fees: number
  fees_currency: string
  wallet_id: string | null
  exchange?: string | null
  from_ticker: string | null
  to_ticker: string | null
  direction?: string | null
  leverage?: number | null
}

type Lot = {
  lot_id: string
  date: string
  exchange: string | null
  qty_original: number
  qty_remaining: number
  cost_per_unit_notional: number
  cost_per_unit_margin: number
  total_cost_notional: number
  total_cost_margin: number
  leverage: number | null
  source: 'BUY' | 'SWAP' | 'AIRDROP' | 'DEPOSIT'
  direction: 'LONG' | 'SHORT'
  short_open_action: 'BUY' | 'SELL' | null
}

type PositionRow = {
  wallet_id: string
  wallet_name: string
  exchange: string | null
  accounting_method: 'LIFO' | 'FIFO' | 'AVG'
  ticker: string
  direction: 'LONG' | 'SHORT'
  qty_total: number
  avg_cost: number
  total_cost: number
  price_live: number | null
  value_live: number | null
  pl_unrealized: number | null
  pl_pct: number | null
  leverage: number | null
  lots: Lot[]
}

const STABLES = new Set(['USD', 'USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'USDP', 'GUSD', 'EUR', 'GBP', 'CHF'])

function n(x: any): number {
  const v = Number(x)
  return Number.isFinite(v) ? v : 0
}

function marginNotional(rawNotionalUsd: number, leverage: number | null | undefined) {
  const lev = Number(leverage)
  if (Number.isFinite(lev) && lev > 1) return rawNotionalUsd / lev
  return rawNotionalUsd
}

function normalizeExchange(exchange: string | null | undefined): string {
  return String(exchange || '').trim().toUpperCase() || 'UNKNOWN'
}

function computeLots(
  transactions: Tx[],
  method: 'LIFO' | 'FIFO' | 'AVG'
): Map<string, Lot[]> {
  const lots = new Map<string, Lot[]>()
  const transferPool = new Map<string, Array<{ qty: number; costNotional: number; costMargin: number }>>()

  const side = (tx: Tx): 'LONG' | 'SHORT' =>
    String(tx.direction || 'LONG').toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG'

  const k = (ticker: string, direction: 'LONG' | 'SHORT') =>
    `${ticker.toUpperCase()}::${direction}`

  const getLots = (key: string) => {
    if (!lots.has(key)) lots.set(key, [])
    return lots.get(key)!
  }

  const addLot = (key: string, lot: Lot) => {
    getLots(key).push(lot)
  }

  const removeLots = (
    key: string,
    qtyToRemove: number,
    preferredExchange?: string
  ): { qtyRemoved: number; costNotionalRemoved: number; costMarginRemoved: number } => {
    const arr = getLots(key)
    if (!arr.length) return { qtyRemoved: 0, costNotionalRemoved: 0, costMarginRemoved: 0 }

    const removeFromPool = (
      pool: Lot[],
      qtyWanted: number
    ): { qtyRemoved: number; costNotionalRemoved: number; costMarginRemoved: number } => {
      if (!pool.length || qtyWanted <= 1e-12) return { qtyRemoved: 0, costNotionalRemoved: 0, costMarginRemoved: 0 }

      if (method === 'AVG') {
        const totalQty = pool.reduce((s, l) => s + l.qty_remaining, 0)
        const totalCostNotional = pool.reduce((s, l) => s + l.total_cost_notional, 0)
        const totalCostMargin = pool.reduce((s, l) => s + l.total_cost_margin, 0)
        const avgCostNotional = totalQty > 0 ? totalCostNotional / totalQty : 0
        const avgCostMargin = totalQty > 0 ? totalCostMargin / totalQty : 0
        const qtyToTake = Math.min(qtyWanted, totalQty)

        for (const lot of pool) {
          const ratio = totalQty > 0 ? lot.qty_remaining / totalQty : 0
          const qtyTaken = qtyToTake * ratio
          lot.qty_remaining -= qtyTaken
          lot.total_cost_notional = lot.qty_remaining * avgCostNotional
          lot.total_cost_margin = lot.qty_remaining * avgCostMargin
        }

        return {
          qtyRemoved: qtyToTake,
          costNotionalRemoved: qtyToTake * avgCostNotional,
          costMarginRemoved: qtyToTake * avgCostMargin,
        }
      }

      const ordered = method === 'LIFO' ? [...pool].reverse() : pool
      let remaining = qtyWanted
      let qtyRemoved = 0
      let costNotionalRemoved = 0
      let costMarginRemoved = 0
      for (const lot of ordered) {
        if (remaining <= 1e-12) break
        const take = Math.min(lot.qty_remaining, remaining)
        qtyRemoved += take
        costNotionalRemoved += take * lot.cost_per_unit_notional
        costMarginRemoved += take * lot.cost_per_unit_margin
        lot.qty_remaining -= take
        lot.total_cost_notional = lot.qty_remaining * lot.cost_per_unit_notional
        lot.total_cost_margin = lot.qty_remaining * lot.cost_per_unit_margin
        remaining -= take
      }
      return { qtyRemoved, costNotionalRemoved, costMarginRemoved }
    }

    let remaining = qtyToRemove
    let qtyRemoved = 0
    let costNotionalRemoved = 0
    let costMarginRemoved = 0

    if (preferredExchange) {
      const preferred = arr.filter((l) => normalizeExchange(l.exchange) === preferredExchange)
      const first = removeFromPool(preferred, remaining)
      remaining -= first.qtyRemoved
      qtyRemoved += first.qtyRemoved
      costNotionalRemoved += first.costNotionalRemoved
      costMarginRemoved += first.costMarginRemoved
    }

    if (remaining > 1e-12) {
      const fallback = preferredExchange
        ? arr.filter((l) => normalizeExchange(l.exchange) !== preferredExchange)
        : arr
      const second = removeFromPool(fallback, remaining)
      qtyRemoved += second.qtyRemoved
      costNotionalRemoved += second.costNotionalRemoved
      costMarginRemoved += second.costMarginRemoved
    }

    lots.set(key, arr.filter((l) => l.qty_remaining > 1e-12))
    return { qtyRemoved, costNotionalRemoved, costMarginRemoved }
  }

  const pushTransferCost = (ticker: string, qty: number, costNotional: number, costMargin: number) => {
    if (!Number.isFinite(qty) || qty <= 1e-12) return
    if (!transferPool.has(ticker)) transferPool.set(ticker, [])
    transferPool.get(ticker)!.push({ qty, costNotional, costMargin })
  }

  const consumeTransferCost = (ticker: string, qtyRequested: number) => {
    const arr = transferPool.get(ticker) || []
    let qtyLeft = Math.max(0, qtyRequested)
    let qty = 0
    let costNotional = 0
    let costMargin = 0

    while (qtyLeft > 1e-12 && arr.length > 0) {
      const head = arr[0]
      const take = Math.min(qtyLeft, head.qty)
      const ratio = head.qty > 0 ? take / head.qty : 0
      qty += take
      costNotional += head.costNotional * ratio
      costMargin += head.costMargin * ratio
      head.qty -= take
      head.costNotional -= head.costNotional * ratio
      head.costMargin -= head.costMargin * ratio
      qtyLeft -= take
      if (head.qty <= 1e-12) arr.shift()
    }

    transferPool.set(ticker, arr)
    return { qty, costNotional, costMargin }
  }

  const txsSorted = [...transactions].sort(
    (a, b) => {
      const ta = new Date(a.date).getTime()
      const tb = new Date(b.date).getTime()
      if (ta !== tb) return ta - tb
      const rank = (action: string) => {
        const up = String(action || '').toUpperCase()
        if (up === 'WITHDRAWAL') return 0
        if (up === 'DEPOSIT') return 1
        return 2
      }
      return rank(a.action) - rank(b.action)
    }
  )

  for (const tx of txsSorted) {
    const action = String(tx.action || '').toUpperCase()
    const ticker = String(tx.ticker || '').toUpperCase()
    const exchange = normalizeExchange(tx.exchange)
    const qty = n(tx.quantity)
    const price = n(tx.price)
    const priceCur = String(tx.price_currency || 'USDT').toUpperCase()
    const fees = n(tx.fees)
    const feesCur = String(tx.fees_currency || 'USDT').toUpperCase()
    const feeUsd = STABLES.has(feesCur) ? fees : 0
    const direction = side(tx)
    const posKey = k(ticker, direction)

    if (action === 'AIRDROP') {
      addLot(k(ticker, 'LONG'), {
        lot_id: tx.id,
        date: tx.date,
        exchange,
        qty_original: qty,
        qty_remaining: qty,
        cost_per_unit_notional: 0,
        cost_per_unit_margin: 0,
        total_cost_notional: 0,
        total_cost_margin: 0,
        leverage: null,
        source: 'AIRDROP',
        direction: 'LONG',
        short_open_action: null,
      })
      continue
    }

    if (action === 'DEPOSIT') {
      if (!STABLES.has(ticker)) {
        const inherited = consumeTransferCost(ticker, qty)
        if (inherited.qty > 1e-12) {
          addLot(k(ticker, 'LONG'), {
            lot_id: tx.id,
            date: tx.date,
            exchange,
            qty_original: inherited.qty,
            qty_remaining: inherited.qty,
            cost_per_unit_notional: inherited.costNotional / inherited.qty,
            cost_per_unit_margin: inherited.costMargin / inherited.qty,
            total_cost_notional: inherited.costNotional,
            total_cost_margin: inherited.costMargin,
            leverage: null,
            source: 'DEPOSIT',
            direction: 'LONG',
            short_open_action: null,
          })
        }
        const leftoverQty = Math.max(0, qty - inherited.qty)
        if (leftoverQty > 1e-12) {
          addLot(k(ticker, 'LONG'), {
            lot_id: tx.id,
            date: tx.date,
            exchange,
            qty_original: leftoverQty,
            qty_remaining: leftoverQty,
            cost_per_unit_notional: 0,
            cost_per_unit_margin: 0,
            total_cost_notional: 0,
            total_cost_margin: 0,
            leverage: null,
            source: 'DEPOSIT',
            direction: 'LONG',
            short_open_action: null,
          })
        }
      }
      continue
    }

    if (action === 'WITHDRAWAL') {
      const removed = removeLots(k(ticker, 'LONG'), qty, exchange)
      pushTransferCost(ticker, removed.qtyRemoved, removed.costNotionalRemoved, removed.costMarginRemoved)
      continue
    }

    if (action === 'BUY') {
      if (!STABLES.has(priceCur)) {
        const key = direction === 'SHORT' ? k(ticker, 'SHORT') : k(ticker, 'LONG')
        addLot(key, {
          lot_id: tx.id,
          date: tx.date,
          exchange,
          qty_original: qty,
          qty_remaining: qty,
          cost_per_unit_notional: 0,
          cost_per_unit_margin: 0,
          total_cost_notional: 0,
          total_cost_margin: 0,
          leverage: null,
          source: 'BUY',
          direction,
          short_open_action: null,
        })
        continue
      }

      if (direction === 'SHORT') {
        const arr = getLots(posKey)
        const mode = arr[0]?.short_open_action || (arr.length > 0 ? 'SELL' : null)
        if (mode === 'BUY' || mode == null) {
          const totalCostNotional = qty * price + feeUsd
          const totalCostMargin = marginNotional(qty * price, tx.leverage) + feeUsd
          addLot(posKey, {
            lot_id: tx.id,
            date: tx.date,
            exchange,
            qty_original: qty,
            qty_remaining: qty,
            cost_per_unit_notional: totalCostNotional / qty,
            cost_per_unit_margin: totalCostMargin / qty,
            total_cost_notional: totalCostNotional,
            total_cost_margin: totalCostMargin,
            leverage: Number.isFinite(Number(tx.leverage)) ? Number(tx.leverage) : null,
            source: 'BUY',
            direction: 'SHORT',
            short_open_action: 'BUY',
          })
        } else {
          removeLots(posKey, qty)
        }
        continue
      }

      const totalCostNotional = qty * price + feeUsd
      const totalCostMargin = marginNotional(qty * price, tx.leverage) + feeUsd
      const costPerUnitNotional = totalCostNotional / qty
      const costPerUnitMargin = totalCostMargin / qty
      addLot(k(ticker, 'LONG'), {
        lot_id: tx.id,
        date: tx.date,
        exchange,
        qty_original: qty,
        qty_remaining: qty,
        cost_per_unit_notional: costPerUnitNotional,
        cost_per_unit_margin: costPerUnitMargin,
        total_cost_notional: totalCostNotional,
        total_cost_margin: totalCostMargin,
        leverage: Number.isFinite(Number(tx.leverage)) ? Number(tx.leverage) : null,
        source: 'BUY',
        direction: 'LONG',
        short_open_action: null,
      })
      continue
    }

    if (action === 'SELL') {
      if (direction === 'SHORT') {
        const arr = getLots(posKey)
        const mode = arr[0]?.short_open_action || (arr.length > 0 ? 'SELL' : null)
        if (mode === 'BUY') {
          removeLots(posKey, qty)
        } else {
          const totalCostNotional = qty * price - feeUsd
          const totalCostMargin = marginNotional(qty * price, tx.leverage) + feeUsd
          addLot(posKey, {
            lot_id: tx.id,
            date: tx.date,
            exchange,
            qty_original: qty,
            qty_remaining: qty,
            cost_per_unit_notional: totalCostNotional / qty,
            cost_per_unit_margin: totalCostMargin / qty,
            total_cost_notional: totalCostNotional,
            total_cost_margin: totalCostMargin,
            leverage: Number.isFinite(Number(tx.leverage)) ? Number(tx.leverage) : null,
            source: 'BUY',
            direction: 'SHORT',
            short_open_action: 'SELL',
          })
        }
      } else {
        removeLots(k(ticker, 'LONG'), qty, exchange)
      }
      continue
    }

    if (action === 'SWAP') {
      const recvTicker = String(tx.to_ticker || tx.ticker || '').toUpperCase()
      const paidTicker = String(tx.from_ticker || tx.price_currency || '').toUpperCase()
      const recvQty = qty
      const paidQty = qty * price
      if (!recvTicker || !paidTicker || recvQty <= 0 || paidQty <= 0) continue

      if (STABLES.has(paidTicker)) {
        const totalCost = paidQty + feeUsd
        const costPerUnit = totalCost / recvQty
        addLot(k(recvTicker, 'LONG'), {
          lot_id: tx.id,
          date: tx.date,
          exchange,
          qty_original: recvQty,
          qty_remaining: recvQty,
          cost_per_unit_notional: costPerUnit,
          cost_per_unit_margin: costPerUnit,
          total_cost_notional: totalCost,
          total_cost_margin: totalCost,
          leverage: null,
          source: 'SWAP',
          direction: 'LONG',
          short_open_action: null,
        })
        continue
      }

      const removed = removeLots(k(paidTicker, 'LONG'), paidQty, exchange)
      const totalCost = removed.costNotionalRemoved + feeUsd
      const costPerUnit = recvQty > 0 ? totalCost / recvQty : 0

      addLot(k(recvTicker, 'LONG'), {
        lot_id: tx.id,
        date: tx.date,
        exchange,
        qty_original: recvQty,
        qty_remaining: recvQty,
        cost_per_unit_notional: costPerUnit,
        cost_per_unit_margin: costPerUnit,
        total_cost_notional: totalCost,
        total_cost_margin: totalCost,
        leverage: null,
        source: 'SWAP',
        direction: 'LONG',
        short_open_action: null,
      })
      continue
    }
  }

  for (const key of [...lots.keys()]) {
    const ticker = key.split('::')[0]
    if (STABLES.has(ticker)) lots.delete(key)
  }

  return lots
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: wallets } = await supabase
    .from('wallets')
    .select('id,name,parent_wallet_id')
    .eq('user_id', user.id)

  const allWallets = wallets || []
  const subwallets = allWallets.filter((w) => w.parent_wallet_id !== null)
  const subIds = subwallets.map((w) => w.id)

  const methodMap = new Map<string, 'LIFO' | 'FIFO' | 'AVG'>()
  if (subIds.length > 0) {
    const { data: settingsRows } = await supabase
      .from('wallet_settings')
      .select('wallet_id,accounting_method')
      .eq('user_id', user.id)
      .in('wallet_id', subIds)

    for (const s of settingsRows || []) {
      methodMap.set(s.wallet_id, (s.accounting_method as 'LIFO' | 'FIFO' | 'AVG') || 'AVG')
    }
  }

  const { data: txs } = await supabase
    .from('transactions')
    .select('id,date,action,ticker,quantity,price,price_currency,fees,fees_currency,wallet_id,exchange,from_ticker,to_ticker,direction,leverage')
    .eq('user_id', user.id)

  type Bucket = { id: string; name: string; method: 'LIFO' | 'FIFO' | 'AVG'; txs: Tx[] }
  const walletById = new Map(subwallets.map((w) => [w.id, w]))
  const bucketById = new Map<string, Bucket>()

  for (const sw of subwallets) {
    bucketById.set(sw.id, {
      id: sw.id,
      name: sw.name,
      method: methodMap.get(sw.id) || 'AVG',
      txs: [],
    })
  }

  const exchangeOnlyFundingTxs: Tx[] = []

  for (const txRaw of txs || []) {
    const tx = txRaw as Tx
    const wid = tx.wallet_id

    if (wid && walletById.has(wid)) {
      bucketById.get(wid)!.txs.push(tx)
      continue
    }

    if (!wid) {
      const action = String(tx.action || '').toUpperCase()
      const ticker = String(tx.ticker || '').toUpperCase()
      if ((action === 'DEPOSIT' || action === 'WITHDRAWAL') && ticker && !STABLES.has(ticker)) {
        exchangeOnlyFundingTxs.push(tx)
      }
    }
  }

  // Attach exchange-only funding transfers to an existing wallet bucket with same ticker.
  // This keeps one main row while exposing exchange split in lot details.
  for (const tx of exchangeOnlyFundingTxs) {
    const ticker = String(tx.ticker || '').toUpperCase()
    const txExchange = normalizeExchange(tx.exchange)

    const candidates = Array.from(bucketById.values())
      .map((bucket) => {
        const hasTicker = bucket.txs.some((btx) => String(btx.ticker || '').toUpperCase() === ticker)
        if (!hasTicker) return null
        const hasSameExchange = bucket.txs.some((btx) => normalizeExchange((btx as Tx).exchange) === txExchange)
        const score = hasSameExchange ? 2 : 1
        return { bucket, score }
      })
      .filter((v): v is { bucket: Bucket; score: number } => v != null)
      .sort((a, b) => b.score - a.score || a.bucket.name.localeCompare(b.bucket.name))

    if (candidates.length > 0) {
      candidates[0].bucket.txs.push(tx)
    }
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const { data: priceRows } = await admin
    .from('prices_cache')
    .select('ticker, price_usd')

  const pricesCache = new Map<string, number>()
  for (const p of priceRows || []) {
    pricesCache.set(p.ticker.toUpperCase(), Number(p.price_usd))
  }

  const positions: PositionRow[] = []

  for (const bucket of bucketById.values()) {
    if (bucket.txs.length === 0) continue
    const lotsMap = computeLots(bucket.txs, bucket.method)

    for (const [key, lotArr] of lotsMap.entries()) {
      if (lotArr.length === 0) continue
      const [ticker, directionRaw] = key.split('::')
      const direction = (directionRaw === 'SHORT' ? 'SHORT' : 'LONG') as 'LONG' | 'SHORT'
      const exchanges = Array.from(new Set(lotArr.map((l) => normalizeExchange(l.exchange))))
      const exchange = exchanges.length === 1 ? exchanges[0] : 'MULTI'

      const qty_total = lotArr.reduce((s, l) => s + l.qty_remaining, 0)
      const total_cost = lotArr.reduce((s, l) => s + l.total_cost_margin, 0)
      const total_notional_cost = lotArr.reduce((s, l) => s + l.total_cost_notional, 0)
      if (qty_total < 1e-9) continue

      const avg_cost = total_cost / qty_total
      const price_live = pricesCache.get(ticker) ?? null
      const pl_unrealized = price_live != null
        ? (direction === 'SHORT'
          ? (total_notional_cost - qty_total * price_live)
          : (qty_total * price_live - total_notional_cost))
        : null
      const value_live = pl_unrealized != null ? total_cost + pl_unrealized : null
      const pl_pct = pl_unrealized != null && total_cost > 0
        ? (pl_unrealized / total_cost) * 100
        : null

      const sortedLots = bucket.method === 'LIFO'
        ? [...lotArr].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        : [...lotArr].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

      const levLots = lotArr
        .map((l) => (Number.isFinite(Number(l.leverage)) ? Number(l.leverage) : null))
        .filter((v): v is number => v != null && v > 1)
      const leverage = levLots.length > 0 ? Math.max(...levLots) : null

      positions.push({
        wallet_id: bucket.id,
        wallet_name: bucket.name,
        exchange,
        accounting_method: bucket.method,
        ticker,
        direction,
        qty_total,
        avg_cost,
        total_cost,
        price_live,
        value_live,
        pl_unrealized,
        pl_pct,
        leverage,
        lots: sortedLots,
      })
    }
  }

  positions.sort((a, b) => {
    const wCmp = a.wallet_name.localeCompare(b.wallet_name)
    if (wCmp !== 0) return wCmp
    const exCmp = String(a.exchange || '').localeCompare(String(b.exchange || ''))
    if (exCmp !== 0) return exCmp
    return a.ticker.localeCompare(b.ticker)
  })

  return NextResponse.json({ positions })
}
