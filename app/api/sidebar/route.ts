// app/api/sidebar/route.ts
import { NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export async function GET() {
  try {
    const supabase = createRouteHandlerClient({ cookies })

    // Auth check
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Fetch wallets with their hierarchy
    const { data: wallets, error: walletsError } = await supabase
      .from('wallets')
      .select('id, name, parent_wallet_id, wallet_type')
      .order('name')

    if (walletsError) throw walletsError

    // Fetch exchanges
    const { data: exchanges, error: exchangesError } = await supabase
      .from('exchanges')
      .select('id, name')
      .order('name')

    if (exchangesError) throw exchangesError

    return NextResponse.json({
      wallets: wallets || [],
      exchanges: exchanges || []
    })
  } catch (error: any) {
    console.error('Error fetching sidebar data:', error)
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    )
  }
}
