import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { id } = params

    const { error } = await supabase
      .from('transactions')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { id } = params
    const body = await request.json()
    const { data: existingTx, error: existingTxError } = await supabase
      .from('transactions')
      .select('id,action,ticker,wallet_id')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (existingTxError || !existingTx) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
    }

    const updates: any = {}

    if (body.date) updates.date = new Date(body.date).toISOString()
    if (body.action) updates.action = String(body.action).toUpperCase()
    if (body.ticker) updates.ticker = String(body.ticker).toUpperCase()

    if (body.quantity !== undefined) updates.quantity = parseFloat(body.quantity)
    if (body.price !== undefined) updates.price = body.price === null ? null : parseFloat(body.price)
    if (body.price_currency !== undefined) updates.price_currency = body.price_currency ? String(body.price_currency).toUpperCase() : null

    if (body.exchange !== undefined) updates.exchange = body.exchange
    if (body.wallet_id !== undefined) updates.wallet_id = body.wallet_id

    if (body.fees !== undefined) updates.fees = parseFloat(body.fees)
    if (body.fees_currency !== undefined) updates.fees_currency = body.fees_currency ? String(body.fees_currency).toUpperCase() : null

    if (body.notes !== undefined) updates.notes = body.notes

    // ✅ SWAP/derivatives fields
    if (body.from_ticker !== undefined) updates.from_ticker = body.from_ticker ? String(body.from_ticker).toUpperCase() : null
    if (body.to_ticker !== undefined) updates.to_ticker = body.to_ticker ? String(body.to_ticker).toUpperCase() : null
    if (body.direction !== undefined) updates.direction = body.direction ? String(body.direction).toUpperCase() : null
    if (body.leverage !== undefined) updates.leverage = body.leverage === null ? null : parseFloat(body.leverage)

    if (updates.leverage !== undefined && updates.leverage !== null) {
      if (!Number.isFinite(updates.leverage) || updates.leverage < 1) {
        return NextResponse.json({ error: 'leverage must be a number >= 1' }, { status: 400 })
      }
      const dir = updates.direction !== undefined ? updates.direction : undefined
      if (dir !== undefined && dir !== null && dir !== 'LONG' && dir !== 'SHORT') {
        return NextResponse.json({ error: 'direction must be LONG or SHORT when leverage is provided' }, { status: 400 })
      }
    }

    const finalAction = String((updates.action ?? existingTx.action) || '').toUpperCase()
    if (['DEPOSIT', 'WITHDRAWAL', 'AIRDROP'].includes(finalAction)) {
      updates.price = 0
      updates.price_currency = null
    }

    if (body.wallet_id) {
      const { data: wallet, error: walletError } = await supabase
        .from('wallets')
        .select('id,parent_wallet_id')
        .eq('id', body.wallet_id)
        .eq('user_id', user.id)
        .single()

      if (walletError || !wallet) {
        return NextResponse.json(
          { error: 'Invalid wallet_id or wallet does not belong to user' },
          { status: 400 }
        )
      }
    }

    const { data, error } = await supabase
      .from('transactions')
      .update(updates)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })

    return NextResponse.json(data, { status: 200 })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
