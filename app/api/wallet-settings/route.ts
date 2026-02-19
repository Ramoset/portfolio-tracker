import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const wallet_id = searchParams.get('wallet_id')
  if (!wallet_id) return NextResponse.json({ error: 'wallet_id is required' }, { status: 400 })

  const { data, error } = await supabase
    .from('wallet_settings')
    .select('wallet_id,target_pct')
    .eq('user_id', user.id)
    .eq('wallet_id', wallet_id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    wallet_id,
    target_pct: data?.target_pct ?? 0,
  })
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const wallet_id = body?.wallet_id
  const target_pct = Number(body?.target_pct)

  if (!wallet_id) return NextResponse.json({ error: 'wallet_id is required' }, { status: 400 })
  if (!Number.isFinite(target_pct) || target_pct < 0 || target_pct > 100) {
    return NextResponse.json({ error: 'target_pct must be between 0 and 100' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('wallet_settings')
    .upsert(
      { user_id: user.id, wallet_id, target_pct },
      { onConflict: 'user_id,wallet_id' }
    )
    .select('wallet_id,target_pct')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}
