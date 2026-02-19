import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const searchParams = request.nextUrl.searchParams
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = (page - 1) * limit

  try {
    const { data: transactions, error } = await supabase
      .from('transactions')
      .select(`
        *,
        wallets!wallet_id (
          id,
          name
        )
      `)
      .eq('user_id', user.id)
      .order('date', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('Supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const transformedTransactions = (transactions || []).map((tx: any) => ({
      ...tx,
      wallet_name: tx.wallets?.name || null,
      wallets: undefined
    }))

    const { count } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)

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

    if (!body.wallet_id) {
      return NextResponse.json({ error: 'wallet_id is required' }, { status: 400 })
    }

    const { data: wallet, error: walletError } = await supabase
      .from('wallets')
      .select('id')
      .eq('id', body.wallet_id)
      .eq('user_id', user.id)
      .single()

    if (walletError || !wallet) {
      return NextResponse.json(
        { error: 'Invalid wallet_id or wallet does not belong to user' },
        { status: 400 }
      )
    }

    const action = String(body.action).toUpperCase()

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

    const payload: any = {
      user_id: user.id,
      wallet_id: body.wallet_id,
      date: new Date(body.date).toISOString(),
      action,
      ticker: String(body.ticker).toUpperCase(),
      type: (body.type ? String(body.type).toUpperCase() : 'CRYPTO'),
      quantity: parseFloat(body.quantity),
      price: body.price !== undefined && body.price !== null ? parseFloat(body.price) : null,
      price_currency: body.price_currency ? String(body.price_currency).toUpperCase() : null,
      fees: body.fees ? parseFloat(body.fees) : 0,
      fees_currency: body.fees_currency ? String(body.fees_currency).toUpperCase() : null,
      exchange: body.exchange || null,
      notes: body.notes || null,

      // ✅ IMPORTANT: store swap/derivatives fields
      from_ticker: body.from_ticker ? String(body.from_ticker).toUpperCase() : null,
      to_ticker: body.to_ticker ? String(body.to_ticker).toUpperCase() : null,
      direction: body.direction ? String(body.direction).toUpperCase() : null,
      leverage: body.leverage !== undefined && body.leverage !== null ? parseFloat(body.leverage) : null,
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
