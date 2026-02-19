import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const body = await request.json().catch(() => ({}))
  const updates: any = {}

  if (body?.status) updates.status = String(body.status)
  if (body?.error_message !== undefined) updates.error_message = body.error_message ? String(body.error_message) : null

  const importedCount = Number(body?.imported_count)
  if (Number.isFinite(importedCount) && importedCount >= 0) updates.imported_count = importedCount

  const skippedCount = Number(body?.skipped_count)
  if (Number.isFinite(skippedCount) && skippedCount >= 0) updates.skipped_count = skippedCount

  const totalRows = Number(body?.total_rows)
  if (Number.isFinite(totalRows) && totalRows >= 0) updates.total_rows = totalRows

  const { data, error } = await admin
    .from('import_batches')
    .update(updates)
    .eq('id', params.id)
    .eq('user_id', user.id)
    .select('id,filename,total_rows,imported_count,skipped_count,status,error_message,created_at')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Import batch not found' }, { status: 404 })
  return NextResponse.json({ batch: data })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const batchId = params.id

  const { data: batch, error: batchErr } = await admin
    .from('import_batches')
    .select('id')
    .eq('id', batchId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (batchErr || !batch?.id) {
    return NextResponse.json({ error: 'Import batch not found' }, { status: 404 })
  }

  const { error: txErr, count: deletedTransactions } = await supabase
    .from('transactions')
    .delete({ count: 'exact' })
    .eq('user_id', user.id)
    .eq('import_batch_id', batchId)

  if (txErr) return NextResponse.json({ error: txErr.message }, { status: 500 })

  const { error: delBatchErr } = await admin
    .from('import_batches')
    .delete()
    .eq('id', batchId)
    .eq('user_id', user.id)

  if (delBatchErr) return NextResponse.json({ error: delBatchErr.message }, { status: 500 })

  return NextResponse.json({ success: true, deleted_transactions: deletedTransactions || 0 })
}
