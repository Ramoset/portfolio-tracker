import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { computeLifoAccounting } from '@/lib/accounting/lifo'

type WalletRow = {
  id: string
  name: string
  parent_wallet_id: string | null
  target_allocation_percent: number | null
  cash_reserve_pct: number | null
  level: number
}

type Position = {
  wallet_id: string
  ticker: string
  direction?: 'LONG' | 'SHORT'
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
  cash_reserve_pct: number | null
  
  total_invested: number
  cash_balance: number
  cash_reserve: number
  cash_available: number
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

const STABLES = new Set(['USD', 'USDT', 'USDC', 'DAI', 'BUSD', 'EUR', 'FDUSD', 'TUSD', 'USDP', 'GUSD', 'GBP', 'CHF', 'JPY'])
function normalizeAction(rawAction: any, rawDirection: any): string {
  const action = String(rawAction || '').trim().toUpperCase()
  const direction = String(rawDirection || 'LONG').trim().toUpperCase()
  if (action === 'CLOSE') return direction === 'SHORT' ? 'BUY' : 'SELL'
  if (action === 'OPEN') return direction === 'SHORT' ? 'SELL' : 'BUY'
  return action
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const rootNameFilter = String(url.searchParams.get('root_name') || '').trim().toUpperCase()
  const rootIdFilter = String(url.searchParams.get('root_id') || '').trim()

  const { data: wallets } = await supabase
    .from('wallets')
    .select('id, name, parent_wallet_id, target_allocation_percent, cash_reserve_pct, level')
    .eq('user_id', user.id)
    .order('level', { ascending: true })
    .order('sort_order', { ascending: true })

  const allWallets = wallets || []
  const allRootWallets = allWallets.filter(w => w.parent_wallet_id === null)
  const rootWallets = allRootWallets.filter((w) => {
    if (rootIdFilter && w.id !== rootIdFilter) return false
    if (rootNameFilter && String(w.name || '').trim().toUpperCase() !== rootNameFilter) return false
    return true
  })
  const scopedRootIds = new Set(rootWallets.map((w) => w.id))
  const scopedWallets = allWallets.filter((w) => {
    if (scopedRootIds.size === 0) return false
    let current: any = w
    while (current) {
      if (scopedRootIds.has(current.id)) return true
      current = current.parent_wallet_id
        ? allWallets.find((x) => x.id === current.parent_wallet_id)
        : null
    }
    return false
  })
  const allWalletIds = scopedWallets.map(w => w.id)

  if (allWalletIds.length === 0) {
    return NextResponse.json({ 
      tree: [], 
      global: {
        total_invested: 0,
        cash_balance: 0,
        cash_reserve: 0,
        total_value_live: 0,
        pl_unrealized: 0,
        pl_realized: 0,
        pl_total: 0,
        pl_total_pct: 0,
      }
    })
  }

  const { data: openPositionsRaw } = await supabase
    .from('transactions')
    .select('wallet_id, ticker, action, quantity, price, price_currency, fees, fees_currency, from_ticker, to_ticker, direction, leverage, date')
    .eq('user_id', user.id)
    .in('wallet_id', allWalletIds)
    .order('date', { ascending: true })

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

  const positionsByWallet = new Map<string, Position[]>()
  const closedPLByWallet = new Map<string, number>()
  for (const wallet of scopedWallets) {
    const txs = (openPositionsRaw || []).filter(tx => tx.wallet_id === wallet.id)
    const acc = computeLifoAccounting(txs as any[], STABLES)
    closedPLByWallet.set(wallet.id, Number(acc.pl_realized_total || 0))

    const positions: Position[] = acc.positions
      .filter((p) => !STABLES.has(String(p.ticker || '').toUpperCase()) && Number(p.qty_open) > 1e-9)
      .map((p) => {
        const ticker = String(p.ticker || '').toUpperCase()
        const qty = Number(p.qty_open) || 0
        const totalCost = Number(p.invested_open) || 0
        const openNotional = Number(p.notional_open ?? p.invested_open) || 0
        const livePrice = pricesCache.get(ticker)
        const plUnrealized = livePrice == null
          ? null
          : (p.direction === 'SHORT'
            ? (openNotional - qty * livePrice)
            : (qty * livePrice - openNotional))
        const valueLive = plUnrealized == null ? null : (totalCost + plUnrealized)
        return {
          wallet_id: wallet.id,
          ticker,
          direction: p.direction,
          qty_total: qty,
          total_cost: totalCost,
          value_live: valueLive,
          pl_unrealized: plUnrealized,
        }
      })

    positionsByWallet.set(wallet.id, positions)
  }

  const rawCashByWallet = new Map<string, number>()
  for (const wallet of scopedWallets) {
    const txs = (openPositionsRaw || []).filter(tx => tx.wallet_id === wallet.id)
    const cash = calculateCashBalance(txs)
    rawCashByWallet.set(wallet.id, cash)
  }

  const buildTree = (wallet: WalletRow): TreeNode => {
    const children = scopedWallets.filter(w => w.parent_wallet_id === wallet.id)
    const positions = positionsByWallet.get(wallet.id) || []
    const pl_realized = closedPLByWallet.get(wallet.id) || 0
    const raw_cash = rawCashByWallet.get(wallet.id) || 0

    const direct_invested = positions.reduce((s, p) => s + p.total_cost, 0)
    const total_value_live = positions.reduce((s, p) => s + (p.value_live || 0), 0)
    const pl_unrealized = positions.reduce((s, p) => s + (p.pl_unrealized || 0), 0)

    const childNodes = children.map(buildTree)

    let cash_balance = 0
    let cash_reserve = 0
    let cash_available = 0
    let total_invested = direct_invested
    let actual_allocation: number | null = null

    if (wallet.parent_wallet_id === null) {
      // ROOT WALLET
      const rawPct = Number(wallet.cash_reserve_pct)
      const cashReservePct = Number.isFinite(rawPct) ? rawPct : 0
      
      cash_reserve = (raw_cash * cashReservePct) / 100
      const allocatableBudget = raw_cash - cash_reserve
      cash_balance = allocatableBudget
      
      for (const child of childNodes) {
        if (child.target_allocation != null) {
          const allocated = (allocatableBudget * child.target_allocation) / 100
          child.cash_balance = allocated
          child.cash_available = allocated - child.total_invested + child.pl_realized
        }
      }

      const totalChildrenValue = childNodes.reduce((sum, c) => 
        sum + c.total_invested + c.cash_balance, 0
      )

      if (totalChildrenValue > 0) {
        for (const child of childNodes) {
          const childValue = child.total_invested + child.cash_balance
          child.actual_allocation = (childValue / totalChildrenValue) * 100
        }
      }

      for (const child of childNodes) {
        total_invested += child.total_invested
      }

    } else {
      // SUB WALLET
      cash_balance = 0
      cash_reserve = 0
      cash_available = 0
    }

    const pl_unrealized_pct = total_invested > 0 ? (pl_unrealized / total_invested) * 100 : 0
    const pl_realized_pct = total_invested > 0 ? (pl_realized / total_invested) * 100 : 0
    const pl_total = pl_unrealized + pl_realized
    const pl_total_pct = total_invested > 0 ? (pl_total / total_invested) * 100 : 0

    return {
      id: wallet.id,
      name: wallet.name,
      level: wallet.level,
      parent_id: wallet.parent_wallet_id,
      target_allocation: wallet.target_allocation_percent,
      actual_allocation,
      cash_reserve_pct: wallet.cash_reserve_pct,
      total_invested,
      cash_balance,
      cash_reserve,
      cash_available,
      total_value_live,
      pl_unrealized,
      pl_unrealized_pct,
      pl_realized,
      pl_realized_pct,
      pl_total,
      pl_total_pct,
      children: childNodes,
      positions,
    }
  }

  const tree = rootWallets.map(buildTree)

  // Calculate portfolio totals for root Target % and Actual %
  let portfolioTotalCash = 0
  let portfolioTotalValueLive = 0

  for (const root of tree) {
    const rootTotalCash = root.cash_balance + root.cash_reserve
    portfolioTotalCash += rootTotalCash
    portfolioTotalValueLive += root.total_value_live + rootTotalCash
  }

  // Set Target % and Actual % for roots
  for (const root of tree) {
    const rootTotalCash = root.cash_balance + root.cash_reserve
    const rootCurrentValue = root.total_value_live + rootTotalCash

    // Target % = cash allocation / total portfolio cash
    root.target_allocation = portfolioTotalCash > 0 
      ? (rootTotalCash / portfolioTotalCash) * 100 
      : 0

    // Actual % = current value / total portfolio value
    root.actual_allocation = portfolioTotalValueLive > 0 
      ? (rootCurrentValue / portfolioTotalValueLive) * 100 
      : 0
  }

  const sumTreeNode = (node: TreeNode): { invested: number; cash: number; cashReserve: number; valueLive: number; plUnreal: number; plReal: number } => {
    let invested = node.total_invested
    let cash = node.cash_balance
    let cashReserve = node.cash_reserve
    let valueLive = node.total_value_live
    let plUnreal = node.pl_unrealized
    let plReal = node.pl_realized

    for (const child of node.children) {
      const childSum = sumTreeNode(child)
      invested += childSum.invested
      cash += childSum.cash
      cashReserve += childSum.cashReserve
      valueLive += childSum.valueLive
      plUnreal += childSum.plUnreal
      plReal += childSum.plReal
    }

    return { invested, cash, cashReserve, valueLive, plUnreal, plReal }
  }

  let globalInvested = 0
  let globalCash = 0
  let globalCashReserve = 0
  let globalValueLive = 0
  let globalPlUnreal = 0
  let globalPlReal = 0

  for (const root of tree) {
    const sum = sumTreeNode(root)
    globalInvested += sum.invested
    globalCash += sum.cash
    globalCashReserve += sum.cashReserve
    globalValueLive += sum.valueLive
    globalPlUnreal += sum.plUnreal
    globalPlReal += sum.plReal
  }

  // Real ledger cash across all wallets (prevents allocation double-counting in global cash KPI)
  const globalLedgerCash = Array.from(rawCashByWallet.values()).reduce((acc, v) => acc + (Number(v) || 0), 0)

  const globalKPIs = {
    total_invested: globalInvested,
    cash_balance: globalLedgerCash,
    cash_reserve: globalCashReserve,
    total_value_live: globalValueLive,
    pl_unrealized: globalPlUnreal,
    pl_realized: globalPlReal,
    pl_total: globalPlUnreal + globalPlReal,
    pl_total_pct: globalInvested > 0 ? ((globalPlUnreal + globalPlReal) / globalInvested) * 100 : 0,
  }

  return NextResponse.json({ tree, global: globalKPIs })
}

function calculateCashBalance(txs: any[]): number {
  let cashBalance = 0
  for (const tx of txs) {
    const action = normalizeAction(tx.action, tx.direction)
    const ticker = String(tx.ticker || '').toUpperCase()
    const qty = Number(tx.quantity) || 0
    const price = Number(tx.price) || 0
    const fees = Number(tx.fees) || 0
    const priceCur = String(tx.price_currency || 'USDT').toUpperCase()
    const feesCur = String(tx.fees_currency || 'USDT').toUpperCase()
    const lev = Number(tx.leverage)
    const leverageApplied = Number.isFinite(lev) && lev > 1 ? lev : 1

    if (action === 'DEPOSIT' && STABLES.has(ticker)) {
      cashBalance += qty
    } else if (action === 'WITHDRAWAL' && STABLES.has(ticker)) {
      cashBalance -= qty
      if (STABLES.has(feesCur)) cashBalance -= fees
    } else if (action === 'BUY' && STABLES.has(priceCur)) {
      cashBalance -= (qty * price) / leverageApplied
      if (STABLES.has(feesCur)) cashBalance -= fees
    } else if (action === 'SELL' && STABLES.has(priceCur)) {
      cashBalance += (qty * price) / leverageApplied
      if (STABLES.has(feesCur)) cashBalance -= fees
    } else if (action === 'SWAP') {
      const recvTicker = String(tx.to_ticker || ticker).toUpperCase()
      const paidTicker = String(tx.from_ticker || priceCur).toUpperCase()
      const paidQty = qty * price

      if (STABLES.has(paidTicker)) {
        cashBalance -= paidQty
        if (STABLES.has(feesCur)) cashBalance -= fees
      } else if (STABLES.has(recvTicker)) {
        cashBalance += qty
        if (STABLES.has(feesCur)) cashBalance -= fees
      } else {
        if (STABLES.has(feesCur)) cashBalance -= fees
      }
    }
  }
  return cashBalance
}

function calculateLots(txs: any[], pricesCache: Map<string, number>): Position[] {
  const lots = new Map<string, {
    ticker: string
    direction: 'LONG' | 'SHORT'
    qty: number
    cost_notional: number
    cost_margin: number
    short_open_action: 'BUY' | 'SELL' | null
  }>()
  const side = (tx: any): 'LONG' | 'SHORT' =>
    String(tx.direction || 'LONG').toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG'
  const keyOf = (ticker: string, direction: 'LONG' | 'SHORT') => `${ticker}::${direction}`
  const getLot = (ticker: string, direction: 'LONG' | 'SHORT') => {
    const key = keyOf(ticker, direction)
    if (!lots.has(key)) {
      lots.set(key, {
        ticker,
        direction,
        qty: 0,
        cost_notional: 0,
        cost_margin: 0,
        short_open_action: null,
      })
    }
    return lots.get(key)!
  }
  
  for (const tx of txs) {
    const action = normalizeAction(tx.action, tx.direction)
    const ticker = String(tx.ticker || '').toUpperCase()
    const qty = Number(tx.quantity) || 0
    const price = Number(tx.price) || 0
    const fees = Number(tx.fees) || 0
    const priceCur = String(tx.price_currency || 'USDT').toUpperCase()
    const feesCur = String(tx.fees_currency || 'USDT').toUpperCase()
    const feeUsd = STABLES.has(feesCur) ? fees : 0
    const lev = Number(tx.leverage)
    const leverageApplied = Number.isFinite(lev) && lev > 1 ? lev : 1
    const direction = side(tx)

    if (action === 'BUY') {
      if (STABLES.has(priceCur)) {
        if (direction === 'SHORT') {
          const lot = getLot(ticker, 'SHORT')
          const mode = lot.short_open_action || (lot.qty > 1e-12 ? 'SELL' : null)
          if (mode === 'BUY' || mode == null) {
            const notional = qty * price
            const margin = notional / leverageApplied
            lot.qty += qty
            lot.cost_notional += notional + feeUsd
            lot.cost_margin += margin + feeUsd
            lot.short_open_action = 'BUY'
          } else {
            const qtyClose = Math.min(qty, lot.qty)
            if (qtyClose > 0) {
              const avgNotional = lot.qty > 0 ? lot.cost_notional / lot.qty : 0
              const avgMargin = lot.qty > 0 ? lot.cost_margin / lot.qty : 0
              lot.qty -= qtyClose
              lot.cost_notional -= qtyClose * avgNotional
              lot.cost_margin -= qtyClose * avgMargin
              if (lot.qty <= 1e-12) lot.short_open_action = null
            }
          }
        } else {
          const lot = getLot(ticker, 'LONG')
          const notional = qty * price
          const margin = notional / leverageApplied
          lot.qty += qty
          lot.cost_notional += notional + feeUsd
          lot.cost_margin += margin + feeUsd
        }
      }
    } else if (action === 'SELL') {
      if (STABLES.has(priceCur)) {
        if (direction === 'SHORT') {
          const lot = getLot(ticker, 'SHORT')
          const mode = lot.short_open_action || (lot.qty > 1e-12 ? 'SELL' : null)
          if (mode === 'BUY') {
            const qtyClose = Math.min(qty, lot.qty)
            const avgNotional = lot.qty > 0 ? lot.cost_notional / lot.qty : 0
            const avgMargin = lot.qty > 0 ? lot.cost_margin / lot.qty : 0
            lot.qty -= qtyClose
            lot.cost_notional -= qtyClose * avgNotional
            lot.cost_margin -= qtyClose * avgMargin
            if (lot.qty <= 1e-12) lot.short_open_action = null
          } else {
            const notional = qty * price
            const margin = notional / leverageApplied
            lot.qty += qty
            lot.cost_notional += notional - feeUsd
            lot.cost_margin += margin + feeUsd
            lot.short_open_action = 'SELL'
          }
        } else {
          const lot = getLot(ticker, 'LONG')
          const qtyClose = Math.min(qty, lot.qty)
          const avgCostNotional = lot.qty > 0 ? lot.cost_notional / lot.qty : 0
          const avgCostMargin = lot.qty > 0 ? lot.cost_margin / lot.qty : 0
          lot.qty -= qtyClose
          lot.cost_notional -= qtyClose * avgCostNotional
          lot.cost_margin -= qtyClose * avgCostMargin
        }
      }
    } else if (action === 'SWAP') {
      const recvTicker = String(tx.to_ticker || ticker).toUpperCase()
      const paidTicker = String(tx.from_ticker || priceCur).toUpperCase()
      const paidQty = qty * price

      if (STABLES.has(paidTicker)) {
        const recvLot = getLot(recvTicker, 'LONG')
        recvLot.qty += qty
        recvLot.cost_notional += paidQty + feeUsd
        recvLot.cost_margin += paidQty + feeUsd
      } else if (STABLES.has(recvTicker)) {
        const paidLot = lots.get(keyOf(paidTicker, 'LONG'))
        if (paidLot) {
          const qtyClose = Math.min(paidQty, paidLot.qty)
          const avgCostNotional = paidLot.qty > 0 ? paidLot.cost_notional / paidLot.qty : 0
          const avgCostMargin = paidLot.qty > 0 ? paidLot.cost_margin / paidLot.qty : 0
          paidLot.qty -= qtyClose
          paidLot.cost_notional -= qtyClose * avgCostNotional
          paidLot.cost_margin -= qtyClose * avgCostMargin
        }
      } else {
        const paidLot = lots.get(keyOf(paidTicker, 'LONG'))
        if (paidLot) {
          const qtyClose = Math.min(paidQty, paidLot.qty)
          const avgCostNotional = paidLot.qty > 0 ? paidLot.cost_notional / paidLot.qty : 0
          const avgCostMargin = paidLot.qty > 0 ? paidLot.cost_margin / paidLot.qty : 0
          const costTransferredNotional = qtyClose * avgCostNotional
          const costTransferredMargin = qtyClose * avgCostMargin
          paidLot.qty -= qtyClose
          paidLot.cost_notional -= costTransferredNotional
          paidLot.cost_margin -= costTransferredMargin

          const recvLot = getLot(recvTicker, 'LONG')
          recvLot.qty += qty
          recvLot.cost_notional += costTransferredNotional + feeUsd
          recvLot.cost_margin += costTransferredMargin + feeUsd
        }
      }
    } else if (action === 'AIRDROP') {
      const lot = getLot(ticker, 'LONG')
      lot.qty += qty
      lot.cost_notional += 0
      lot.cost_margin += 0
    } else if (action === 'DEPOSIT') {
      if (!STABLES.has(ticker)) {
        const lot = getLot(ticker, 'LONG')
        lot.qty += qty
        lot.cost_notional += 0
        lot.cost_margin += 0
      }
    } else if (action === 'WITHDRAWAL') {
      const lot = getLot(ticker, 'LONG')
      const qtyClose = Math.min(qty, lot.qty)
      const avgCostNotional = lot.qty > 0 ? lot.cost_notional / lot.qty : 0
      const avgCostMargin = lot.qty > 0 ? lot.cost_margin / lot.qty : 0
      lot.qty -= qtyClose
      lot.cost_notional -= qtyClose * avgCostNotional
      lot.cost_margin -= qtyClose * avgCostMargin
    }
  }

  for (const ticker of STABLES) {
    lots.delete(keyOf(ticker, 'LONG'))
    lots.delete(keyOf(ticker, 'SHORT'))
  }

  const positions: Position[] = []
  for (const [, lot] of lots.entries()) {
    if (lot.qty < 1e-9) continue
    const priceLive = pricesCache.get(lot.ticker) ?? null
    const plUnrealized = priceLive != null
      ? (lot.direction === 'SHORT'
        ? (lot.cost_notional - lot.qty * priceLive)
        : (lot.qty * priceLive - lot.cost_notional))
      : null
    const valueLive = plUnrealized != null ? lot.cost_margin + plUnrealized : null

    positions.push({
      wallet_id: '',
      ticker: lot.ticker,
      direction: lot.direction,
      qty_total: lot.qty,
      total_cost: lot.cost_margin,
      value_live: valueLive,
      pl_unrealized: plUnrealized,
    })
  }

  return positions
}

function calculateClosedPL(txs: any[]): number {
  const ordered = [...txs].sort((a, b) => {
    const ta = new Date(String(a?.date || '')).getTime()
    const tb = new Date(String(b?.date || '')).getTime()
    if (!Number.isFinite(ta) && !Number.isFinite(tb)) return 0
    if (!Number.isFinite(ta)) return 1
    if (!Number.isFinite(tb)) return -1
    return ta - tb
  })

  const lots = new Map<string, {
    qty: number
    cost: number
    direction: 'LONG' | 'SHORT'
    short_open_action: 'BUY' | 'SELL' | null
  }>()
  let totalPL = 0
  const side = (tx: any): 'LONG' | 'SHORT' =>
    String(tx.direction || 'LONG').toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG'
  const keyOf = (ticker: string, direction: 'LONG' | 'SHORT') => `${ticker}::${direction}`
  const getLot = (ticker: string, direction: 'LONG' | 'SHORT') => {
    const key = keyOf(ticker, direction)
    if (!lots.has(key)) lots.set(key, { qty: 0, cost: 0, direction, short_open_action: null })
    return lots.get(key)!
  }

  for (const tx of ordered) {
    const action = normalizeAction(tx.action, tx.direction)
    const ticker = String(tx.ticker || '').toUpperCase()
    const qty = Number(tx.quantity) || 0
    const price = Number(tx.price) || 0
    const fees = Number(tx.fees) || 0
    const priceCur = String(tx.price_currency || 'USDT').toUpperCase()
    const feesCur = String(tx.fees_currency || 'USDT').toUpperCase()
    const feeUsd = STABLES.has(feesCur) ? fees : 0
    const direction = side(tx)

    if (action === 'BUY') {
      if (STABLES.has(priceCur)) {
        if (direction === 'SHORT') {
          const lot = getLot(ticker, 'SHORT')
          const mode = lot.short_open_action || (lot.qty > 1e-12 ? 'SELL' : null)
          if (mode === 'BUY' || mode == null) {
            lot.qty += qty
            lot.cost += qty * price + feeUsd
            lot.short_open_action = 'BUY'
          } else {
            const avgEntry = lot.qty > 0 ? lot.cost / lot.qty : 0
            const qtyClose = Math.min(qty, lot.qty)
            const closeCost = qtyClose * price + feeUsd
            const entryPart = qtyClose * avgEntry
            totalPL += (entryPart - closeCost)
            lot.qty -= qtyClose
            lot.cost -= entryPart
            if (lot.qty <= 1e-12) lot.short_open_action = null
          }
        } else {
          const lot = getLot(ticker, 'LONG')
          lot.qty += qty
          lot.cost += qty * price + feeUsd
        }
      }
    } else if (action === 'SELL') {
      if (STABLES.has(priceCur)) {
        if (direction === 'SHORT') {
          const lot = getLot(ticker, 'SHORT')
          const mode = lot.short_open_action || (lot.qty > 1e-12 ? 'SELL' : null)
          if (mode === 'BUY') {
            const avgEntry = lot.qty > 0 ? lot.cost / lot.qty : 0
            const qtyClose = Math.min(qty, lot.qty)
            const proceeds = qtyClose * price - feeUsd
            const entryPart = qtyClose * avgEntry
            totalPL += (entryPart - proceeds)
            lot.qty -= qtyClose
            lot.cost -= entryPart
            if (lot.qty <= 1e-12) lot.short_open_action = null
          } else {
            lot.qty += qty
            lot.cost += qty * price - feeUsd
            lot.short_open_action = 'SELL'
          }
        } else {
          const lot = getLot(ticker, 'LONG')
          const avgCost = lot.qty > 0 ? lot.cost / lot.qty : 0
          const qtyClose = Math.min(qty, lot.qty)
          const costBasis = qtyClose * avgCost
          const proceeds = qtyClose * price - feeUsd
          totalPL += (proceeds - costBasis)
          lot.qty -= qtyClose
          lot.cost -= costBasis
        }
      }
    } else if (action === 'SWAP') {
      const recvTicker = String(tx.to_ticker || ticker).toUpperCase()
      const paidTicker = String(tx.from_ticker || priceCur).toUpperCase()
      const paidQty = qty * price

      if (STABLES.has(paidTicker)) {
        const recvLot = getLot(recvTicker, 'LONG')
        recvLot.qty += qty
        recvLot.cost += paidQty + feeUsd
      } else if (STABLES.has(recvTicker)) {
        const paidLot = lots.get(keyOf(paidTicker, 'LONG'))
        if (paidLot) {
          const avgCost = paidLot.qty > 0 ? paidLot.cost / paidLot.qty : 0
          const qtyClose = Math.min(paidQty, paidLot.qty)
          const costBasis = qtyClose * avgCost
          const proceeds = qty - feeUsd
          const pl = proceeds - costBasis
          totalPL += pl

          paidLot.qty -= qtyClose
          paidLot.cost -= costBasis
        }
      }
    }
  }

  return totalPL
}
