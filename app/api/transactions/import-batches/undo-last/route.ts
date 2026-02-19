import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export async function POST() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: latest, error: latestErr } = await admin
    .from('import_batches')
    .select('id,filename,created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latestErr) return NextResponse.json({ error: latestErr.message }, { status: 500 })
  if (!latest?.id) return NextResponse.json({ error: 'No import batches found' }, { status: 404 })

  const { error: txErr, count: deletedTransactions } = await supabase
    .from('transactions')
    .delete({ count: 'exact' })
    .eq('user_id', user.id)
    .eq('import_batch_id', latest.id)

  if (txErr) return NextResponse.json({ error: txErr.message }, { status: 500 })

  const { error: delBatchErr } = await admin
    .from('import_batches')
    .delete()
    .eq('id', latest.id)
    .eq('user_id', user.id)

  if (delBatchErr) return NextResponse.json({ error: delBatchErr.message }, { status: 500 })

  return NextResponse.json({
    success: true,
    batch_id: latest.id,
    filename: latest.filename,
    deleted_transactions: deletedTransactions || 0,
  })
}
