import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const walletId = params.id
  const body = await req.json().catch(() => ({}))

  const name = typeof body.name === 'string' ? body.name.trim() : null
  const parent_wallet_id =
    body.parent_wallet_id === null || typeof body.parent_wallet_id === 'string'
      ? body.parent_wallet_id
      : undefined
  const target_allocation_percent = 
    typeof body.target_allocation_percent === 'number' 
      ? body.target_allocation_percent 
      : undefined
  const cash_reserve_pct = 
    typeof body.cash_reserve_pct === 'number' 
      ? body.cash_reserve_pct 
      : undefined

  // At least one field must be provided
  if (!name && parent_wallet_id === undefined && target_allocation_percent === undefined && cash_reserve_pct === undefined) {
    return NextResponse.json({ error: 'At least one field (name, parent_wallet_id, target_allocation_percent, cash_reserve_pct) is required' }, { status: 400 })
  }

  // Validate target_allocation_percent if provided
  if (target_allocation_percent !== undefined && (target_allocation_percent < 0 || target_allocation_percent > 100)) {
    return NextResponse.json({ error: 'target_allocation_percent must be between 0 and 100' }, { status: 400 })
  }

  // Validate cash_reserve_pct if provided
  if (cash_reserve_pct !== undefined && (cash_reserve_pct < 0 || cash_reserve_pct > 100)) {
    return NextResponse.json({ error: 'cash_reserve_pct must be between 0 and 100' }, { status: 400 })
  }

  if (parent_wallet_id && parent_wallet_id === walletId) {
    return NextResponse.json({ error: 'A wallet cannot be its own parent' }, { status: 400 })
  }

  const { data: existing, error: e0 } = await supabase
    .from('wallets')
    .select('id')
    .eq('id', walletId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (e0) return NextResponse.json({ error: e0.message }, { status: 500 })
  if (!existing) return NextResponse.json({ error: 'Wallet not found' }, { status: 404 })

  if (parent_wallet_id) {
    const { data: p, error: ep } = await supabase
      .from('wallets')
      .select('id')
      .eq('id', parent_wallet_id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (ep) return NextResponse.json({ error: ep.message }, { status: 500 })
    if (!p) return NextResponse.json({ error: 'Parent wallet not found' }, { status: 400 })
  }

  const payload: Partial<{
    name: string
    parent_wallet_id: string | null
    target_allocation_percent: number
    cash_reserve_pct: number
  }> = {}
  if (name) payload.name = name
  if (parent_wallet_id !== undefined) payload.parent_wallet_id = parent_wallet_id
  if (target_allocation_percent !== undefined) payload.target_allocation_percent = target_allocation_percent
  if (cash_reserve_pct !== undefined) payload.cash_reserve_pct = cash_reserve_pct

  const { data: updated, error: e1 } = await supabase
    .from('wallets')
    .update(payload)
    .eq('id', walletId)
    .eq('user_id', user.id)
    .select('id,name,parent_wallet_id,target_allocation_percent,cash_reserve_pct')
    .maybeSingle()

  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })

  return NextResponse.json(updated)
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const walletId = params.id

  const { data: existing, error: e0 } = await supabase
    .from('wallets')
    .select('id')
    .eq('id', walletId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (e0) return NextResponse.json({ error: e0.message }, { status: 500 })
  if (!existing) return NextResponse.json({ error: 'Wallet not found' }, { status: 404 })

  const { count: childrenCount, error: eC } = await supabase
    .from('wallets')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('parent_wallet_id', walletId)

  if (eC) return NextResponse.json({ error: eC.message }, { status: 500 })
  if ((childrenCount || 0) > 0) {
    return NextResponse.json(
      { error: 'Cannot delete: this wallet has subwallets. Move/delete them first.' },
      { status: 400 }
    )
  }

  const { count: txCount, error: eT } = await supabase
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('wallet_id', walletId)

  if (eT) return NextResponse.json({ error: eT.message }, { status: 500 })
  if ((txCount || 0) > 0) {
    return NextResponse.json(
      { error: 'Cannot delete: this wallet has transactions. Reassign them first.' },
      { status: 400 }
    )
  }

  const { error: e1 } = await supabase
    .from('wallets')
    .delete()
    .eq('id', walletId)
    .eq('user_id', user.id)

  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
