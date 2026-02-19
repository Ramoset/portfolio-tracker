import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

const FIAT_STABLECOINS = new Set(['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'FDUSD'])

function isFiatOrStablecoin(ticker: string) {
  return FIAT_STABLECOINS.has(String(ticker || '').toUpperCase())
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const searchParams = request.nextUrl.searchParams
  const page = Math.max(1, parseInt(searchParams.get('page') || '1') || 1)
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50') || 50))
  const offset = (page - 1) * limit
  const q = (searchParams.get('q') || '').trim()
  const ticker = (searchParams.get('ticker') || '').trim().toUpperCase()
  const exchange = (searchParams.get('exchange') || '').trim().toUpperCase()
  const action = (searchParams.get('action') || 'ALL').trim().toUpperCase()
  const wallet = (searchParams.get('wallet') || 'ALL').trim()
  // Sanitize: remove Supabase filter operators and special chars to prevent filter injection
  const qSafe = q.replace(/[(),.%*]/g, ' ').replace(/\b(eq|neq|gt|gte|lt|lte|like|ilike|is|in|cs|cd|sl|sr|nxl|nxr|adj|ov|fts|plfts|phfts|wfts|not|and|or)\b/gi, '').trim()

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

    if (action !== 'ALL') {
      next = next.eq('action', action)
    }

    if (ticker) {
      next = next.ilike('ticker', `%${ticker}%`)
    }

    if (exchange) {
      next = next.ilike('exchange', `%${exchange}%`)
    }

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

  try {
    const txBase = supabase
      .from('transactions')
      .select(`
        *,
        wallets!wallet_id (
          id,
          name
        )
      `)
      .order('date', { ascending: false, nullsFirst: false })

    const filteredTx = await applyFilters(txBase)
    if (filteredTx.empty) {
      return NextResponse.json({
        transactions: [],
        pagination: { page: 1, limit, total: 0, totalPages: 1 }
      })
    }

    const { data: transactions, error } = await filteredTx.query.range(offset, offset + limit - 1)

    if (error) {
      console.error('Supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const transformedTransactions = (transactions || []).map((tx: any) => ({
      ...tx,
      wallet_name: tx.wallets?.name || null,
      wallets: undefined
    }))

    const countBase = supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
    const filteredCount = await applyFilters(countBase)
    const { count } = filteredCount.empty
      ? { count: 0 as number | null }
      : await filteredCount.query

    return NextResponse.json({
      transactions: transformedTransactions,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()

    if (!body.date || !body.action || !body.ticker || body.quantity === undefined) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const action = String(body.action).toUpperCase()
    const ticker = String(body.ticker || '').toUpperCase()
    const isFunding = action === 'DEPOSIT' || action === 'WITHDRAWAL'
    const isCryptoFundingWithoutWallet = isFunding && !isFiatOrStablecoin(ticker)

    if (!isCryptoFundingWithoutWallet && !body.wallet_id) {
      return NextResponse.json({ error: 'wallet_id is required' }, { status: 400 })
    }

    const direction = body.direction ? String(body.direction).toUpperCase() : null
    const leverage = body.leverage !== undefined && body.leverage !== null ? parseFloat(body.leverage) : null

    if (leverage !== null) {
      if (!Number.isFinite(leverage) || leverage < 1) {
        return NextResponse.json({ error: 'leverage must be a number >= 1' }, { status: 400 })
      }
      if (direction !== 'LONG' && direction !== 'SHORT') {
        return NextResponse.json({ error: 'direction must be LONG or SHORT when leverage is provided' }, { status: 400 })
      }
    }

    let sourceWallet: { id: string; name: string; parent_wallet_id: string | null } | null = null
    if (body.wallet_id) {
      const { data: walletRow, error: sourceWalletError } = await supabase
        .from('wallets')
        .select('id,name,parent_wallet_id')
        .eq('id', body.wallet_id)
        .eq('user_id', user.id)
        .single()

      if (sourceWalletError || !walletRow) {
        return NextResponse.json(
          { error: 'Invalid wallet_id or wallet does not belong to user' },
          { status: 400 }
        )
      }
      sourceWallet = walletRow
    }

    // Basic validations for SWAP (legacy)
    if (action === 'SWAP') {
      if (!body.from_ticker || !body.to_ticker) {
        return NextResponse.json(
          { error: 'from_ticker and to_ticker are required for SWAP' },
          { status: 400 }
        )
      }
      if (body.price === undefined || body.price === null) {
        return NextResponse.json(
          { error: 'price is required for SWAP (from per to)' },
          { status: 400 }
        )
      }
      if (!body.price_currency) {
        return NextResponse.json(
          { error: 'price_currency is required for SWAP (should match from_ticker)' },
          { status: 400 }
        )
      }
    }

    // ✅ TRANSFER: create 2 rows (WITHDRAWAL + DEPOSIT)
    if (action === 'TRANSFER') {
      if (!body.to_wallet_id) {
        return NextResponse.json({ error: 'to_wallet_id is required for TRANSFER' }, { status: 400 })
      }
      if (!sourceWallet) {
        return NextResponse.json({ error: 'wallet_id is required for TRANSFER' }, { status: 400 })
      }
      if (String(body.to_wallet_id) === String(body.wallet_id)) {
        return NextResponse.json({ error: 'to_wallet_id must be different from wallet_id' }, { status: 400 })
      }

      // Validate destination wallet belongs to user
      const { data: destWallet, error: destWalletError } = await supabase
        .from('wallets')
        .select('id,name')
        .eq('id', body.to_wallet_id)
        .eq('user_id', user.id)
        .single()

      if (destWalletError || !destWallet) {
        return NextResponse.json(
          { error: 'Invalid to_wallet_id or destination wallet does not belong to user' },
          { status: 400 }
        )
      }

      const isoDate = new Date(body.date).toISOString()
      const ticker = String(body.ticker).toUpperCase()
      const qty = parseFloat(body.quantity)

      if (!Number.isFinite(qty) || qty <= 0) {
        return NextResponse.json({ error: 'quantity must be a positive number' }, { status: 400 })
      }

      const fees = body.fees ? parseFloat(body.fees) : 0
      const feesCurrency = body.fees_currency ? String(body.fees_currency).toUpperCase() : null

      const common = {
        user_id: user.id,
        date: isoDate,
        ticker,
        type: 'CRYPTO',
        quantity: qty,
        price: null,
        price_currency: null,
        exchange: body.exchange || null, // nel tuo form TRANSFER è nascosto, quindi di solito null
        direction: null,
        leverage: null,
        from_ticker: null,
        to_ticker: null,
        notes: body.notes || null,
      } as any

      // 1) OUT from source
      const outRow = {
        ...common,
        wallet_id: sourceWallet.id,
        action: 'WITHDRAWAL',
        fees: Number.isFinite(fees) ? fees : 0,
        fees_currency: feesCurrency,
        notes: `${body.notes ? body.notes + ' | ' : ''}TRANSFER -> ${destWallet.name}`,
      }

      // 2) IN to destination (no fees here to avoid double counting)
      const inRow = {
        ...common,
        wallet_id: destWallet.id,
        action: 'DEPOSIT',
        fees: 0,
        fees_currency: null,
        notes: `${body.notes ? body.notes + ' | ' : ''}TRANSFER <- ${sourceWallet.name}`,
      }

      const { data, error } = await supabase
        .from('transactions')
        .insert([outRow, inRow])
        .select()

      if (error) {
        console.error('Insert TRANSFER error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json(
        {
          transfer: {
            from_wallet_id: sourceWallet.id,
            to_wallet_id: destWallet.id,
            ticker,
            quantity: qty,
          },
          created: data || [],
        },
        { status: 201 }
      )
    }

    // Crypto funding between exchanges (no wallet): create mirrored entry.
    if (isCryptoFundingWithoutWallet) {
      const sourceExchange = String(body.exchange || '').trim()
      const counterpartyExchange = String(body.counterparty_exchange || '').trim()

      if (!sourceExchange || !counterpartyExchange) {
        return NextResponse.json(
          { error: 'exchange and counterparty_exchange are required for crypto funding transfers' },
          { status: 400 }
        )
      }

      if (sourceExchange.toUpperCase() === counterpartyExchange.toUpperCase()) {
        return NextResponse.json(
          { error: 'counterparty_exchange must be different from exchange' },
          { status: 400 }
        )
      }

      const isoDate = new Date(body.date).toISOString()
      const qty = parseFloat(body.quantity)
      if (!Number.isFinite(qty) || qty <= 0) {
        return NextResponse.json({ error: 'quantity must be a positive number' }, { status: 400 })
      }

      const fees = body.fees ? parseFloat(body.fees) : 0
      const feesCurrency = body.fees_currency ? String(body.fees_currency).toUpperCase() : null
      const actionPrimary = action
      const actionMirror = actionPrimary === 'WITHDRAWAL' ? 'DEPOSIT' : 'WITHDRAWAL'
      const tickerUpper = String(body.ticker).toUpperCase()

      const common = {
        user_id: user.id,
        wallet_id: null,
        date: isoDate,
        ticker: tickerUpper,
        type: 'CRYPTO',
        quantity: qty,
        price: 0,
        price_currency: null,
        from_ticker: null,
        to_ticker: null,
        direction: null,
        leverage: null,
      } as const

      const primaryRow = {
        ...common,
        action: actionPrimary,
        exchange: sourceExchange,
        fees: Number.isFinite(fees) ? fees : 0,
        fees_currency: feesCurrency,
        notes: body.notes || null,
      }

      const mirrorRow = {
        ...common,
        action: actionMirror,
        exchange: counterpartyExchange,
        fees: 0,
        fees_currency: null,
        notes: `${body.notes ? body.notes + ' | ' : ''}AUTO-MIRROR ${actionPrimary} ${sourceExchange} -> ${counterpartyExchange}`,
      }

      const { data, error } = await supabase
        .from('transactions')
        .insert([primaryRow, mirrorRow])
        .select()

      if (error) {
        console.error('Insert crypto funding mirror error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json(
        {
          funding_transfer: {
            ticker: tickerUpper,
            quantity: qty,
            from_exchange: actionPrimary === 'WITHDRAWAL' ? sourceExchange : counterpartyExchange,
            to_exchange: actionPrimary === 'WITHDRAWAL' ? counterpartyExchange : sourceExchange,
          },
          created: data || [],
        },
        { status: 201 }
      )
    }

    // Default: single row insert
    const payload: any = {
      user_id: user.id,
      wallet_id: isCryptoFundingWithoutWallet ? null : body.wallet_id,
      date: new Date(body.date).toISOString(),
      action,
      ticker: String(body.ticker).toUpperCase(),
      type: 'CRYPTO',
      quantity: parseFloat(body.quantity),
      price: (['DEPOSIT','WITHDRAWAL','AIRDROP'].includes(action) ? 0 : (body.price !== undefined && body.price !== null ? parseFloat(body.price) : null)),
      price_currency: (['DEPOSIT','WITHDRAWAL','AIRDROP'].includes(action) ? null : (body.price_currency ? String(body.price_currency).toUpperCase() : null)),
      fees: body.fees ? parseFloat(body.fees) : 0,
      fees_currency: body.fees_currency ? String(body.fees_currency).toUpperCase() : null,
      exchange: body.exchange || null,
      notes: body.notes || null,

      // swap/derivatives fields
      from_ticker: body.from_ticker ? String(body.from_ticker).toUpperCase() : null,
      to_ticker: body.to_ticker ? String(body.to_ticker).toUpperCase() : null,
      direction,
      leverage,
    }

    const { data, error } = await supabase
      .from('transactions')
        .insert(payload)
      .select()
      .single()

    if (error) {
      console.error('Insert error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE() {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { error, count } = await supabase
      .from('transactions')
      .delete({ count: 'exact' })
      .eq('user_id', user.id)

    if (error) {
      console.error('Bulk delete error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, deleted: count || 0 })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
