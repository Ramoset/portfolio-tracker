import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()

  // Get authenticated user
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = params

    // Delete transaction (RLS ensures user can only delete their own)
    const { error } = await supabase
      .from('transactions')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) {
      console.error('Delete error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()

  // Get authenticated user
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = params
    const body = await request.json()

    // Build update object (only include provided fields)
    const updates: any = {}

    if (body.date) updates.date = new Date(body.date).toISOString()
    if (body.action) updates.action = body.action.toUpperCase()
    if (body.ticker) updates.ticker = body.ticker.toUpperCase()
    if (body.quantity !== undefined) updates.quantity = parseFloat(body.quantity)
    if (body.price !== undefined) updates.price = parseFloat(body.price)
    if (body.price_currency) updates.price_currency = body.price_currency.toUpperCase()
    if (body.exchange) updates.exchange = body.exchange
    if (body.wallet_id) updates.wallet_id = body.wallet_id
    if (body.fees !== undefined) updates.fees = parseFloat(body.fees)
    if (body.fees_currency) updates.fees_currency = body.fees_currency.toUpperCase()
    if (body.notes !== undefined) updates.notes = body.notes

    // Validate wallet if provided
    if (body.wallet_id) {
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
    }

    // Update transaction
    const { data, error } = await supabase
      .from('transactions')
      .update(updates)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single()

    if (error) {
      console.error('Update error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!data) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
    }

    return NextResponse.json(data, { status: 200 })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
