import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await admin
    .from('import_batches')
    .select('id,filename,source,total_rows,imported_count,skipped_count,status,error_message,created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ batches: data || [] })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const body = await request.json().catch(() => ({}))
  const filename = String(body?.filename || '').trim() || null
  const totalRowsRaw = Number(body?.total_rows)
  const totalRows = Number.isFinite(totalRowsRaw) && totalRowsRaw >= 0 ? totalRowsRaw : null

  const { data, error } = await admin
    .from('import_batches')
    .insert({
      user_id: user.id,
      source: 'csv',
      filename,
      total_rows: totalRows,
      imported_count: 0,
      skipped_count: 0,
      status: 'processing',
    })
    .select('id,filename,source,total_rows,imported_count,skipped_count,status,error_message,created_at')
    .single()

  if (error || !data) return NextResponse.json({ error: error?.message || 'Failed to create import batch' }, { status: 500 })
  return NextResponse.json({ batch: data }, { status: 201 })
}
