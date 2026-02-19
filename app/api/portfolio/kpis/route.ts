import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { computeLifoAccounting, normalizeAction } from '@/lib/accounting/lifo'

type Tx = {
  id: string
  date: string
  action: 'BUY' | 'SELL' | 'DEPOSIT' | 'WITHDRAWAL' | 'SWAP' | 'AIRDROP' | 'FEE'
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

type WalletRow = {
  id: string
  name: string
  parent_wallet_id: string | null
}

const STABLES = new Set(['USD', 'USDT', 'USDC', 'DAI', 'EUR', 'BUSD', 'FDUSD', 'TUSD', 'USDP', 'GUSD', 'GBP', 'CHF', 'JPY'])

function n(x: any) {
  const v = Number(x)
  return Number.isFinite(v) ? v : 0
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

function computeAccounting(transactions: Tx[]) {
  const { invested_open_total, pl_realized_total } = computeLifoAccounting(transactions, STABLES)
  return { invested_open_total, pl_realized_total }
}

function computeAccountingWithPositions(transactions: Tx[]) {
  return computeLifoAccounting(transactions, STABLES)
}

function buildChildrenMap(wallets: WalletRow[]) {
  const children = new Map<string, string[]>()
  wallets.forEach((w) => {
    if (!w.parent_wallet_id) return
    const p = w.parent_wallet_id
    children.set(p, [...(children.get(p) || []), w.id])
  })
  return children
}

function collectDescendants(rootId: string, childrenMap: Map<string, string[]>) {
  const out = new Set<string>()
  const q: string[] = [rootId]
  while (q.length) {
    const cur = q.shift()!
    out.add(cur)
    const kids = childrenMap.get(cur) || []
    for (const k of kids) {
      if (!out.has(k)) q.push(k)
    }
  }
  return Array.from(out)
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const rootNameFilter = String(url.searchParams.get('root_name') || '').trim().toUpperCase()
  const rootIdFilter = String(url.searchParams.get('root_id') || '').trim()

  // 1) Wallets
  const { data: wallets, error: wErr } = await supabase
    .from('wallets')
    .select('id,name,parent_wallet_id')
    .eq('user_id', user.id)

  if (wErr) return NextResponse.json({ error: wErr.message }, { status: 500 })

  const w = (wallets || []) as WalletRow[]
  const allRoots = w.filter((x) => !x.parent_wallet_id)
  const roots = allRoots.filter((root) => {
    if (rootIdFilter && root.id !== rootIdFilter) return false
    if (rootNameFilter && String(root.name || '').trim().toUpperCase() !== rootNameFilter) return false
    return true
  })

  // 2) All transactions once
  const { data: txs, error: tErr } = await supabase
    .from('transactions')
    .select('id,date,action,ticker,quantity,price,price_currency,fees,fees_currency,wallet_id,exchange,from_ticker,to_ticker,direction,leverage')
    .eq('user_id', user.id)

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })

  const allTxs = (txs || []) as Tx[]
  const txByWallet = new Map<string, Tx[]>()
  for (const tx of allTxs) {
    if (!tx.wallet_id) continue
    const id = String(tx.wallet_id)
    txByWallet.set(id, [...(txByWallet.get(id) || []), tx])
  }

  const childrenMap = buildChildrenMap(w)

  // Carica prezzi live dalla cache (service role per bypassare RLS)
  const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const { data: priceRows } = await supabaseAdmin
    .from('prices_cache')
    .select('ticker, price_usd')
  const pricesCache = new Map<string, number>()
  for (const row of priceRows || []) {
    pricesCache.set(row.ticker.toUpperCase(), Number(row.price_usd))
  }

  const rows = roots.map((root) => {
    const walletIds = collectDescendants(root.id, childrenMap)

    // Accounting: su TUTTI i wallet di quel root (root + subwallet + eventuali livelli)
    const txForRoot: Tx[] = []
    for (const wid of walletIds) {
      const arr = txByWallet.get(wid) || []
      txForRoot.push(...arr)
    }

    // Depositi netti in stile sheet:
    // per exchange (Broker), solo stablecoin, formula DEPOSIT - WITHDRAWAL.
    const depositsByExchange = new Map<string, { deposits: number; withdrawals: number; net: number }>()
    let depositsGross = 0
    let withdrawalsGross = 0
    for (const t of txForRoot) {
      const a = normalizeAction(t.action, t.direction)
      const tk = String(t.ticker || '').toUpperCase()
      const q = n(t.quantity)
      if (!STABLES.has(tk)) continue
      if (a !== 'DEPOSIT' && a !== 'WITHDRAWAL') continue

      const exchange = String((t as any).exchange || '').trim().toUpperCase() || 'UNKNOWN'
      const cur = depositsByExchange.get(exchange) || { deposits: 0, withdrawals: 0, net: 0 }
      if (a === 'DEPOSIT') {
        cur.deposits += q
        depositsGross += q
      } else {
        cur.withdrawals += q
        withdrawalsGross += q
      }
      cur.net = cur.deposits - cur.withdrawals
      depositsByExchange.set(exchange, cur)
    }
    const deposits = Array.from(depositsByExchange.values()).reduce((sum, v) => sum + v.net, 0)

    const { invested_open_total, pl_realized_total } = computeAccounting(txForRoot)
    const fees_total = txForRoot.reduce((sum, tx) => sum + estimateFeeUsd(tx), 0)

    // Unrealized: calcolato con i prezzi live dalla cache
    const pl_unrealized = txForRoot.length > 0
      ? (() => {
          // Ricostruiamo le posizioni aperte per calcolare il valore live
          const { positions } = computeAccountingWithPositions(txForRoot)
          return positions.reduce((sum, p) => {
            if (p.qty_open <= 0 || STABLES.has(p.ticker)) return sum
            const livePrice = pricesCache.get(p.ticker)
            if (livePrice == null) return sum
            const openNotional = p.notional_open ?? p.invested_open
            const pnl = p.direction === 'SHORT'
              ? (openNotional - (p.qty_open * livePrice))
              : ((p.qty_open * livePrice) - openNotional)
            return sum + pnl
          }, 0)
        })()
      : 0

    const deposits_plus_realized = deposits + pl_realized_total
    const invested_plus_realized = invested_open_total + pl_realized_total
    const invested_plus_unrealized = invested_open_total + pl_unrealized
    const balance_live = deposits + pl_realized_total + pl_unrealized

    // Cash contabile: depositi + realized - investito (stessa logica che hai scritto tu)
    const cash = deposits + pl_realized_total - invested_open_total

    return {
      root_wallet_id: root.id,
      root_wallet_name: root.name,
      deposits,
      pl_realized: pl_realized_total,
      pl_unrealized,
      deposits_plus_realized,
      invested_open: invested_open_total,
      invested_plus_realized,
      invested_plus_unrealized,
      balance_live,
      cash,
      fees_total,
      deposits_gross: depositsGross,
      withdrawals_gross: withdrawalsGross,
      deposits_by_exchange: Object.fromEntries(
        Array.from(depositsByExchange.entries()).sort((a, b) => a[0].localeCompare(b[0]))
      ),
    }
  })

  const totals = rows.reduce(
    (acc, r) => {
      acc.deposits += r.deposits
      acc.pl_realized += r.pl_realized
      acc.pl_unrealized += r.pl_unrealized
      acc.deposits_plus_realized += r.deposits_plus_realized
      acc.invested_open += r.invested_open
      acc.invested_plus_realized += r.invested_plus_realized
      acc.invested_plus_unrealized += r.invested_plus_unrealized
      acc.balance_live += r.balance_live
      acc.cash += r.cash
      acc.fees_total += r.fees_total
      acc.deposits_gross += r.deposits_gross
      acc.withdrawals_gross += r.withdrawals_gross
      return acc
    },
    {
      deposits: 0,
      pl_realized: 0,
      pl_unrealized: 0,
      deposits_plus_realized: 0,
      invested_open: 0,
      invested_plus_realized: 0,
      invested_plus_unrealized: 0,
      balance_live: 0,
      cash: 0,
      fees_total: 0,
      deposits_gross: 0,
      withdrawals_gross: 0,
    }
  )

  return NextResponse.json({
    meta: { user_id: user.id, roots_count: roots.length },
    totals,
    rows,
  })
}
