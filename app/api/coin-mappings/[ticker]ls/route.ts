import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

// DELETE /api/coin-mappings/[ticker]
export async function DELETE(_: Request, ctx: { params: { ticker: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ticker = decodeURIComponent(ctx.params.ticker).toUpperCase().trim()
  if (!ticker) return NextResponse.json({ error: 'ticker obbligatorio' }, { status: 400 })

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { error } = await admin
    .from('coin_mappings')
    .delete()
    .eq('ticker', ticker)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}