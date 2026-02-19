import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

function escCsv(value: unknown): string {
  const raw = value == null ? '' : String(value)
  if (/[",\n\r]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`
  return raw
}

function toCsv(rows: Array<Record<string, unknown>>, headers: string[]) {
  const lines: string[] = []
  lines.push(headers.join(','))
  for (const row of rows) {
    lines.push(headers.map((h) => escCsv(row[h])).join(','))
  }
  // BOM for Excel compatibility
  return `\uFEFF${lines.join('\n')}`
}

function formatExportDate(value: unknown): string {
  if (!value) return ''
  const d = new Date(String(value))
  if (!Number.isFinite(d.getTime())) return ''

  // Export in local time to stay consistent with UI/manual entry.
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = String(d.getFullYear())
  const hour = String(d.getHours())
  const minute = String(d.getMinutes()).padStart(2, '0')
  const second = String(d.getSeconds()).padStart(2, '0')

  return `${day}/${month}/${year} ${hour}.${minute}.${second}`
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const searchParams = request.nextUrl.searchParams
    const q = (searchParams.get('q') || '').trim()
    const ticker = (searchParams.get('ticker') || '').trim().toUpperCase()
    const exchange = (searchParams.get('exchange') || '').trim().toUpperCase()
    const action = (searchParams.get('action') || 'ALL').trim().toUpperCase()
    const wallet = (searchParams.get('wallet') || 'ALL').trim()
    const qSafe = q.replace(/[(),]/g, ' ').trim()

    const resolveWalletIdsByName = async (name: string) => {
      const { data } = await supabase
        .from('wallets')
        .select('id')
        .eq('user_id', user.id)
        .eq('name', name)
      return (data || []).map((w: any) => w.id)
    }

    const resolveWalletIdsBySearch = async (term: string) => {
      const { data } = await supabase
        .from('wallets')
        .select('id')
        .eq('user_id', user.id)
        .ilike('name', `%${term}%`)
      return (data || []).map((w: any) => w.id)
    }

    const applyFilters = async (query: any) => {
      let next = query.eq('user_id', user.id)

      if (action !== 'ALL') next = next.eq('action', action)
      if (ticker) next = next.ilike('ticker', `%${ticker}%`)
      if (exchange) next = next.ilike('exchange', `%${exchange}%`)

      if (wallet !== 'ALL') {
        if (wallet === 'UNASSIGNED') {
          next = next.is('wallet_id', null)
        } else {
          const walletIds = await resolveWalletIdsByName(wallet)
          if (walletIds.length === 0) {
            return { query: null as any, empty: true }
          }
          next = next.in('wallet_id', walletIds)
        }
      }

      if (qSafe) {
        const walletIdsBySearch = await resolveWalletIdsBySearch(qSafe)
        const orParts = [
          `ticker.ilike.%${qSafe}%`,
          `action.ilike.%${qSafe}%`,
          `exchange.ilike.%${qSafe}%`,
          `notes.ilike.%${qSafe}%`,
          `price_currency.ilike.%${qSafe}%`,
          `fees_currency.ilike.%${qSafe}%`,
          `from_ticker.ilike.%${qSafe}%`,
          `to_ticker.ilike.%${qSafe}%`,
          `type.ilike.%${qSafe}%`,
          `direction.ilike.%${qSafe}%`,
        ]
        if (walletIdsBySearch.length > 0) {
          orParts.push(`wallet_id.in.(${walletIdsBySearch.join(',')})`)
        }
        next = next.or(orParts.join(','))
      }

      return { query: next, empty: false }
    }

    const base = supabase
      .from('transactions')
      .select(`
        id,
        date,
        action,
        ticker,
        quantity,
        price,
        price_currency,
        fees,
        fees_currency,
        exchange,
        direction,
        leverage,
        from_ticker,
        to_ticker,
        notes,
        wallet_id,
        wallets!wallet_id (name)
      `)
      .order('date', { ascending: true, nullsFirst: false })

    const filtered = await applyFilters(base)
    if (filtered.empty) {
      const csv = toCsv([], [
        'date', 'action', 'ticker', 'wallet', 'exchange', 'quantity', 'price', 'price_currency',
        'fees', 'fees_currency', 'direction', 'leverage', 'from_ticker', 'to_ticker', 'notes',
      ])
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="transactions-export-${new Date().toISOString().slice(0, 10)}.csv"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    const allTx: any[] = []
    const chunk = 1000
    let from = 0

    while (true) {
      const { data, error } = await filtered.query.range(from, from + chunk - 1)
      if (error) {
        console.error('Export range error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      const rows = data || []
      allTx.push(...rows)
      if (rows.length < chunk) break
      from += chunk
    }

    const csvRows = allTx.map((tx: any) => ({
      date: formatExportDate(tx.date),
      action: tx.action || '',
      ticker: tx.ticker || '',
      wallet: tx.wallets?.name || '',
      exchange: tx.exchange || '',
      quantity: tx.quantity ?? '',
      price: tx.price ?? '',
      price_currency: tx.price_currency || '',
      fees: tx.fees ?? '',
      fees_currency: tx.fees_currency || '',
      direction: tx.direction || '',
      leverage: tx.leverage ?? '',
      from_ticker: tx.from_ticker || '',
      to_ticker: tx.to_ticker || '',
      notes: tx.notes || '',
    }))

    const headers = [
      'date', 'action', 'ticker', 'wallet', 'exchange', 'quantity', 'price', 'price_currency',
      'fees', 'fees_currency', 'direction', 'leverage', 'from_ticker', 'to_ticker', 'notes',
    ]

    const csv = toCsv(csvRows, headers)

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="transactions-export-${new Date().toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('Export API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
