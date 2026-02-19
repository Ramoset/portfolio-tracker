import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type TxRow = {
  id: string
  date: string | null
  action: string | null
  ticker: string | null
  wallet_id: string | null
  exchange: string | null
  quantity: number | null
  price: number | null
  price_currency: string | null
  fees: number | null
  fees_currency: string | null
  direction: string | null
  leverage: number | null
  from_ticker: string | null
  to_ticker: string | null
  notes: string | null
  created_at: string | null
}

function normText(v: unknown, upper = false) {
  const s = String(v ?? '').trim()
  return upper ? s.toUpperCase() : s
}

function normNum(v: unknown) {
  const n = Number(v)
  return Number.isFinite(n) ? n.toString() : ''
}

function normDate(v: unknown) {
  const raw = String(v ?? '').trim()
  if (!raw) return ''
  const d = new Date(raw)
  return Number.isFinite(d.getTime()) ? d.toISOString() : raw
}

function txKey(tx: TxRow) {
  return [
    normDate(tx.date),
    normText(tx.action, true),
    normText(tx.ticker, true),
    normText(tx.wallet_id),
    normText(tx.exchange, true),
    normNum(tx.quantity),
    normNum(tx.price),
    normText(tx.price_currency, true),
    normNum(tx.fees),
    normText(tx.fees_currency, true),
    normText(tx.direction, true),
    normNum(tx.leverage),
    normText(tx.from_ticker, true),
    normText(tx.to_ticker, true),
    normText(tx.notes),
  ].join('|')
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const all: TxRow[] = []
  const chunk = 1000
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from('transactions')
      .select('id,date,action,ticker,wallet_id,exchange,quantity,price,price_currency,fees,fees_currency,direction,leverage,from_ticker,to_ticker,notes,created_at')
      .eq('user_id', user.id)
      .order('date', { ascending: true, nullsFirst: false })
      .range(from, from + chunk - 1)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const rows = (data || []) as TxRow[]
    all.push(...rows)
    if (rows.length < chunk) break
    from += chunk
  }

  const groups = new Map<string, TxRow[]>()
  for (const tx of all) {
    const key = txKey(tx)
    const bucket = groups.get(key)
    if (bucket) bucket.push(tx)
    else groups.set(key, [tx])
  }

  const idsToDelete: string[] = []
  let duplicateGroups = 0

  for (const group of groups.values()) {
    if (group.length <= 1) continue
    duplicateGroups += 1

    const sorted = [...group].sort((a, b) => {
      const aT = new Date(String(a.created_at || a.date || '')).getTime()
      const bT = new Date(String(b.created_at || b.date || '')).getTime()
      if (aT !== bT) return aT - bT
      return String(a.id).localeCompare(String(b.id))
    })

    for (let i = 1; i < sorted.length; i++) idsToDelete.push(sorted[i].id)
  }

  return NextResponse.json({
    total_transactions: all.length,
    duplicate_groups: duplicateGroups,
    duplicates_to_delete: idsToDelete.length,
    ids_to_delete: idsToDelete,
  })
}

