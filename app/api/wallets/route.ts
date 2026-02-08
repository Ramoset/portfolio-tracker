import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('wallets')
    .select('id,name,level,parent_wallet_id,sort_order')
    .eq('user_id', user.id)
    .order('level', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ wallets: data || [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json()

    // Validate required fields
    if (!body.name || !body.name.trim()) {
      return NextResponse.json({ error: 'Wallet name is required' }, { status: 400 })
    }

    // Check if wallet with same name already exists for this user
    const { data: existing } = await supabase
      .from('wallets')
      .select('id')
      .eq('user_id', user.id)
      .eq('name', body.name.trim())
      .single()

    if (existing) {
      return NextResponse.json({ error: 'Wallet with this name already exists' }, { status: 400 })
    }

    // Calculate level
    let level = 0
    if (body.parent_wallet_id) {
      // Get parent wallet level
      const { data: parent, error: parentError } = await supabase
        .from('wallets')
        .select('level')
        .eq('id', body.parent_wallet_id)
        .eq('user_id', user.id)
        .single()

      if (parentError || !parent) {
        return NextResponse.json({ error: 'Invalid parent wallet' }, { status: 400 })
      }

      level = parent.level + 1
    }

    // Insert new wallet
    const { data: newWallet, error } = await supabase
      .from('wallets')
      .insert({
        user_id: user.id,
        name: body.name.trim(),
        parent_wallet_id: body.parent_wallet_id || null,
        level,
        sort_order: body.sort_order || 0,
      })
      .select()
      .single()

    if (error) {
      console.error('Insert wallet error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(newWallet, { status: 201 })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}