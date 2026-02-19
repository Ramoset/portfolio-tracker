import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

type ExchangeStats = {
  exchange_name: string
  total_invested: number
  cash_balance: number
  fees_total: number
  total_value_live: number
  global_live_value: number
  pl_unrealized: number
  pl_realized: number
  pl_total: number
  pl_total_pct: number
  transaction_count: number
  first_transaction_date: string
  last_transaction_date: string
  token_count: number
}

type ExchangePosition = {
  position_key: string
  ticker: string
  position_type: 'SPOT' | 'LEVERAGE'
  leverage: number | null
  qty_open: number
  avg_cost: number
  invested_open: number
  price_live: number | null
  value_live: number | null
  weight_invested_pct: number
  weight_live_pct: number
  pl_realized: number
  pl_unrealized: number | null
  pl_total: number | null
}

type ExchangeMovement = {
  id: string
  date: string
  action: string
  ticker: string
  wallet_id: string | null
  wallet_name: string | null
  quantity: number
  price: number
  price_currency: string
  fees: number
  fees_currency: string
  notes: string | null
}

type Direction = 'LONG' | 'SHORT'

type OpenPos = {
  ticker: string
  direction: Direction
  qty: number
  total_cost_notional: number
  total_cost_margin: number
  short_open_action: 'BUY' | 'SELL' | null
}

const STABLES = new Set(['USD', 'USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'USDP', 'GUSD', 'EUR', 'GBP', 'CHF', 'FDUSD'])

function n(x: any): number {
  const v = Number(x)
  return Number.isFinite(v) ? v : 0
}

function marginNotional(rawNotionalUsd: number, leverage: number | null | undefined) {
  const lev = Number(leverage)
  if (Number.isFinite(lev) && lev > 1) return rawNotionalUsd / lev
  return rawNotionalUsd
}

function side(tx: any): Direction {
  return String(tx.direction || 'LONG').toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG'
}

function estimateFeeUsd(tx: any) {
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

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const url = new URL(request.url)
    const exchangeQuery = (url.searchParams.get('exchange') || '').trim()

    const { data: transactions, error: txError } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', user.id)
      .order('date', { ascending: true })

    if (txError) throw txError

    const { data: wallets } = await supabase
      .from('wallets')
      .select('id,name')
      .eq('user_id', user.id)

    const walletNames = new Map<string, string>()
    for (const w of wallets || []) walletNames.set(String(w.id), String(w.name || ''))

    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const { data: priceRows } = await admin
      .from('prices_cache')
      .select('ticker, price_usd')

    const pricesCache = new Map<string, number>()
    for (const p of priceRows || []) {
      pricesCache.set(String(p.ticker || '').toUpperCase(), Number(p.price_usd))
    }

    const exchangeMap = new Map<string, { transactions: any[]; stats: ExchangeStats }>()

    for (const tx of transactions || []) {
      const exchange = String(tx.exchange || 'Unknown')
      if (!exchangeMap.has(exchange)) {
        exchangeMap.set(exchange, {
          transactions: [],
          stats: {
            exchange_name: exchange,
            total_invested: 0,
            cash_balance: 0,
            fees_total: 0,
            total_value_live: 0,
            global_live_value: 0,
            pl_unrealized: 0,
            pl_realized: 0,
            pl_total: 0,
            pl_total_pct: 0,
            transaction_count: 0,
            first_transaction_date: tx.date,
            last_transaction_date: tx.date,
            token_count: 0,
          },
        })
      }
      const ex = exchangeMap.get(exchange)!
      ex.transactions.push(tx)
      ex.stats.transaction_count++
      ex.stats.last_transaction_date = tx.date
    }

    const detailByExchange = new Map<string, { positions: ExchangePosition[]; movements: ExchangeMovement[] }>()
    const openByExchange = new Map<string, Map<string, OpenPos>>()
    const transferPool = new Map<string, Array<{ qty: number; costNotional: number; costMargin: number }>>()

    const keyOf = (ticker: string, direction: Direction) => `${ticker}::${direction}`
    const getOpenMap = (exchange: string) => {
      if (!openByExchange.has(exchange)) openByExchange.set(exchange, new Map<string, OpenPos>())
      return openByExchange.get(exchange)!
    }
    const getPos = (exchange: string, ticker: string, direction: Direction) => {
      const openMap = getOpenMap(exchange)
      const key = keyOf(ticker, direction)
      if (!openMap.has(key)) {
        openMap.set(key, {
          ticker,
          direction,
          qty: 0,
          total_cost_notional: 0,
          total_cost_margin: 0,
          short_open_action: null,
        })
      }
      return openMap.get(key)!
    }

    const enqueueTransfer = (ticker: string, qty: number, costNotional: number, costMargin: number) => {
      if (qty <= 1e-12) return
      if (!transferPool.has(ticker)) transferPool.set(ticker, [])
      transferPool.get(ticker)!.push({ qty, costNotional, costMargin })
    }

    const consumeTransfer = (ticker: string, qty: number) => {
      const arr = transferPool.get(ticker) || []
      let remaining = qty
      let costNotional = 0
      let costMargin = 0
      while (remaining > 1e-12 && arr.length > 0) {
        const head = arr[0]
        const take = Math.min(remaining, head.qty)
        const ratio = head.qty > 0 ? take / head.qty : 0
        costNotional += head.costNotional * ratio
        costMargin += head.costMargin * ratio
        head.qty -= take
        head.costNotional -= head.costNotional * ratio
        head.costMargin -= head.costMargin * ratio
        remaining -= take
        if (head.qty <= 1e-12) arr.shift()
      }
      transferPool.set(ticker, arr)
      return { costNotional, costMargin, unmatchedQty: Math.max(0, remaining) }
    }

    const removeLongAtCost = (exchange: string, ticker: string, qty: number) => {
      const pos = getPos(exchange, ticker, 'LONG')
      const qtyRemoved = Math.min(qty, Math.max(0, pos.qty))
      const avgNotional = pos.qty > 0 ? pos.total_cost_notional / pos.qty : 0
      const avgMargin = pos.qty > 0 ? pos.total_cost_margin / pos.qty : 0
      const removedNotional = qtyRemoved * avgNotional
      const removedMargin = qtyRemoved * avgMargin
      pos.qty -= qtyRemoved
      pos.total_cost_notional -= removedNotional
      pos.total_cost_margin -= removedMargin
      return { qtyRemoved, removedNotional, removedMargin }
    }

    for (const tx of transactions || []) {
      const exchange = String(tx.exchange || 'Unknown')
      const exData = exchangeMap.get(exchange)
      if (!exData) continue
      const stats = exData.stats

      const action = String(tx.action || '').toUpperCase()
      const ticker = String(tx.ticker || '').toUpperCase()
      const qty = n(tx.quantity)
      const price = n(tx.price)
      const priceCur = String(tx.price_currency || 'USDT').toUpperCase()
      const fees = n(tx.fees)
      const feesCur = String(tx.fees_currency || 'USDT').toUpperCase()
      const feeUsd = STABLES.has(feesCur) ? fees : 0
      stats.fees_total += estimateFeeUsd(tx)
      const direction = side(tx)

      switch (action) {
        case 'DEPOSIT':
          if (STABLES.has(ticker)) {
            stats.cash_balance += qty
          } else {
            const recv = consumeTransfer(ticker, qty)
            const pos = getPos(exchange, ticker, 'LONG')
            pos.qty += qty
            // Carry cost basis from previous withdrawals when available.
            pos.total_cost_notional += recv.costNotional
            pos.total_cost_margin += recv.costMargin
          }
          break

        case 'WITHDRAWAL':
          if (STABLES.has(ticker)) {
            stats.cash_balance -= qty
          } else {
            const removed = removeLongAtCost(exchange, ticker, qty)
            // Store removed cost so a later deposit on another exchange can inherit it.
            enqueueTransfer(ticker, removed.qtyRemoved, removed.removedNotional, removed.removedMargin)
          }
          break

        case 'BUY':
          if (STABLES.has(priceCur)) {
            if (direction === 'SHORT') {
              const pos = getPos(exchange, ticker, 'SHORT')
              const mode = pos.short_open_action || (pos.qty > 1e-12 ? 'SELL' : null)
              if (mode === 'BUY' || mode == null) {
                const totalNotional = qty * price + feeUsd
                const totalMargin = marginNotional(qty * price, tx.leverage) + feeUsd
                pos.qty += qty
                pos.total_cost_notional += totalNotional
                pos.total_cost_margin += totalMargin
                pos.short_open_action = 'BUY'
              } else {
                const qtyClose = Math.min(qty, pos.qty)
                const avgNotional = pos.qty > 0 ? pos.total_cost_notional / pos.qty : 0
                const avgMargin = pos.qty > 0 ? pos.total_cost_margin / pos.qty : 0
                const entryPart = qtyClose * avgNotional
                const marginPart = qtyClose * avgMargin
                const buybackCost = qtyClose * price + feeUsd
                stats.pl_realized += entryPart - buybackCost
                pos.qty -= qtyClose
                pos.total_cost_notional -= entryPart
                pos.total_cost_margin -= marginPart
                if (pos.qty <= 1e-12) pos.short_open_action = null
              }
            } else {
              const pos = getPos(exchange, ticker, 'LONG')
              const totalNotional = qty * price + feeUsd
              const totalMargin = marginNotional(qty * price, tx.leverage) + feeUsd
              pos.qty += qty
              pos.total_cost_notional += totalNotional
              pos.total_cost_margin += totalMargin
            }
          } else {
            if (direction === 'SHORT') getPos(exchange, ticker, 'SHORT').qty = Math.max(0, getPos(exchange, ticker, 'SHORT').qty - qty)
            else getPos(exchange, ticker, 'LONG').qty += qty
          }
          break

        case 'SELL':
          if (STABLES.has(priceCur)) {
            if (direction === 'SHORT') {
              const pos = getPos(exchange, ticker, 'SHORT')
              const mode = pos.short_open_action || (pos.qty > 1e-12 ? 'SELL' : null)
              if (mode === 'BUY') {
                const qtyClose = Math.min(qty, pos.qty)
                const avgNotional = pos.qty > 0 ? pos.total_cost_notional / pos.qty : 0
                const avgMargin = pos.qty > 0 ? pos.total_cost_margin / pos.qty : 0
                const entryPart = qtyClose * avgNotional
                const marginPart = qtyClose * avgMargin
                const proceeds = qtyClose * price - feeUsd
                stats.pl_realized += entryPart - proceeds
                pos.qty -= qtyClose
                pos.total_cost_notional -= entryPart
                pos.total_cost_margin -= marginPart
                if (pos.qty <= 1e-12) pos.short_open_action = null
              } else {
                const notional = qty * price
                const margin = marginNotional(notional, tx.leverage) + feeUsd
                pos.qty += qty
                pos.total_cost_notional += notional - feeUsd
                pos.total_cost_margin += margin
                pos.short_open_action = 'SELL'
              }
            } else {
              const pos = getPos(exchange, ticker, 'LONG')
              const qtyClose = Math.min(qty, pos.qty)
              const avgCostNotional = pos.qty > 0 ? pos.total_cost_notional / pos.qty : 0
              const avgCostMargin = pos.qty > 0 ? pos.total_cost_margin / pos.qty : 0
              const soldNotional = qtyClose * avgCostNotional
              const soldMargin = qtyClose * avgCostMargin
              const revenue = qtyClose * price - feeUsd
              stats.pl_realized += revenue - soldNotional
              pos.qty -= qtyClose
              pos.total_cost_notional -= soldNotional
              pos.total_cost_margin -= soldMargin
            }
          } else {
            if (direction === 'SHORT') getPos(exchange, ticker, 'SHORT').qty += qty
            else getPos(exchange, ticker, 'LONG').qty = Math.max(0, getPos(exchange, ticker, 'LONG').qty - qty)
          }
          break

        case 'SWAP': {
          const recvTicker = String(tx.to_ticker || tx.ticker || '').toUpperCase()
          const paidTicker = String(tx.from_ticker || tx.price_currency || '').toUpperCase()
          const recvQty = qty
          const paidQty = qty * price

          if (STABLES.has(paidTicker)) {
            const totalCost = paidQty + feeUsd
            const recvPos = getPos(exchange, recvTicker, 'LONG')
            recvPos.qty += recvQty
            recvPos.total_cost_notional += totalCost
            recvPos.total_cost_margin += totalCost
          } else {
            const removed = removeLongAtCost(exchange, paidTicker, paidQty)
            const recvPos = getPos(exchange, recvTicker, 'LONG')
            recvPos.qty += recvQty
            recvPos.total_cost_notional += removed.removedNotional + feeUsd
            recvPos.total_cost_margin += removed.removedMargin + feeUsd
          }
          break
        }

        case 'AIRDROP':
          getPos(exchange, ticker, 'LONG').qty += qty
          break
      }
    }

    for (const [exchangeName, exData] of exchangeMap.entries()) {
      const stats = exData.stats
      const openPositions = getOpenMap(exchangeName)
      const txs = exData.transactions

      const positions: ExchangePosition[] = []
      let investedSum = 0
      let liveSum = 0

      for (const [key, pos] of openPositions.entries()) {
        if (pos.qty <= 1e-9 || STABLES.has(pos.ticker)) continue

        const priceLive = pricesCache.get(pos.ticker)
        const plUnrealized = priceLive != null
          ? (pos.direction === 'SHORT'
            ? (pos.total_cost_notional - pos.qty * priceLive)
            : (pos.qty * priceLive - pos.total_cost_notional))
          : null
        const valueLive = plUnrealized != null ? (pos.total_cost_margin + plUnrealized) : null

        investedSum += pos.total_cost_margin
        liveSum += valueLive ?? 0

        const lev = pos.total_cost_margin > 0
          ? (pos.total_cost_notional / pos.total_cost_margin)
          : null
        const leverage = lev != null && Number.isFinite(lev) && lev > 1.01 ? Number(lev.toFixed(2)) : null

        positions.push({
          position_key: key,
          ticker: pos.ticker,
          position_type: leverage ? 'LEVERAGE' : 'SPOT',
          leverage,
          qty_open: pos.qty,
          avg_cost: pos.qty > 0 ? pos.total_cost_margin / pos.qty : 0,
          invested_open: pos.total_cost_margin,
          price_live: priceLive ?? null,
          value_live: valueLive,
          weight_invested_pct: 0,
          weight_live_pct: 0,
          pl_realized: 0,
          pl_unrealized: plUnrealized,
          pl_total: plUnrealized,
        })
      }

      for (const p of positions) {
        p.weight_invested_pct = investedSum > 0 ? (p.invested_open / investedSum) * 100 : 0
        p.weight_live_pct = liveSum > 0 && p.value_live != null ? (p.value_live / liveSum) * 100 : 0
      }

      stats.total_invested = investedSum
      stats.total_value_live = liveSum
      stats.token_count = positions.length
      stats.pl_unrealized = positions.reduce((s, p) => s + (p.pl_unrealized || 0), 0)
      stats.pl_total = stats.pl_unrealized + stats.pl_realized
      stats.global_live_value = stats.cash_balance + stats.total_value_live
      stats.pl_total_pct = stats.total_invested > 0 ? (stats.pl_total / stats.total_invested) * 100 : 0

      const movements: ExchangeMovement[] = [...txs]
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 50)
        .map((m: any) => ({
          id: String(m.id),
          date: String(m.date),
          action: String(m.action || ''),
          ticker: String(m.ticker || ''),
          wallet_id: m.wallet_id ? String(m.wallet_id) : null,
          wallet_name: m.wallet_id ? (walletNames.get(String(m.wallet_id)) || null) : null,
          quantity: n(m.quantity),
          price: n(m.price),
          price_currency: String(m.price_currency || ''),
          fees: n(m.fees),
          fees_currency: String(m.fees_currency || ''),
          notes: m.notes ? String(m.notes) : null,
        }))

      detailByExchange.set(exchangeName, { positions, movements })
    }

    const list = Array.from(exchangeMap.values())
      .map(ex => ex.stats)
      .sort((a, b) => b.total_invested - a.total_invested)

    if (!exchangeQuery) return NextResponse.json(list)

    let wanted: string
    try {
      wanted = decodeURIComponent(exchangeQuery).replace(/[<>{}]/g, '').trim()
    } catch {
      return NextResponse.json({ error: 'Invalid exchange parameter' }, { status: 400 })
    }
    if (!wanted || wanted.length > 200) {
      return NextResponse.json({ error: 'Invalid exchange parameter' }, { status: 400 })
    }
    let matchedName = list.find(e => e.exchange_name === wanted)?.exchange_name || null
    if (!matchedName) {
      const lower = wanted.toLowerCase()
      matchedName = list.find(e => e.exchange_name.toLowerCase() === lower)?.exchange_name || null
    }

    if (!matchedName) {
      return NextResponse.json({
        exchange_name: wanted,
        total_invested: 0,
        cash_balance: 0,
        fees_total: 0,
        total_value_live: 0,
        global_live_value: 0,
        pl_unrealized: 0,
        pl_realized: 0,
        pl_total: 0,
        pl_total_pct: 0,
        transaction_count: 0,
        first_transaction_date: '',
        last_transaction_date: '',
        token_count: 0,
        positions: [],
        movements: [],
      })
    }

    const stats = list.find(e => e.exchange_name === matchedName)!
    const detail = detailByExchange.get(matchedName) || { positions: [], movements: [] }
    return NextResponse.json({ ...stats, positions: detail.positions, movements: detail.movements })
  } catch (error: any) {
    console.error('Error fetching exchange stats:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
