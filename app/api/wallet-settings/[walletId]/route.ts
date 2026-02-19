import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _request: Request,
  { params }: { params: { walletId: string } }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const walletId = params.walletId

  const { data, error } = await supabase
    .from('wallet_settings')
    .select('wallet_id,target_pct,notes,created_at,updated_at')
    .eq('wallet_id', walletId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Se non esiste ancora, ritorniamo default (senza creare)
  return NextResponse.json({
    settings: data ?? { wallet_id: walletId, target_pct: 0, notes: null },
  })
}

export async function PUT(
  request: Request,
  { params }: { params: { walletId: string } }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const walletId = params.walletId
  const body = await request.json().catch(() => ({}))

  const targetPctRaw = body?.target_pct
  const target_pct = Number(targetPctRaw)
  if (!Number.isFinite(target_pct) || target_pct < 0 || target_pct > 1000) {
    return NextResponse.json({ error: 'Invalid target_pct' }, { status: 400 })
  }

  const notes = typeof body?.notes === 'string' ? body.notes : null

  const { data, error } = await supabase
    .from('wallet_settings')
    .upsert(
      {
        wallet_id: walletId,
        user_id: user.id,
        target_pct,
        notes,
      },
      { onConflict: 'wallet_id' }
    )
    .select('wallet_id,target_pct,notes,created_at,updated_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ settings: data })
}
