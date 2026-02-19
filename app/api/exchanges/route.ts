// app/api/exchanges/route.ts
import { NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export async function GET() {
  try {
    const supabase = createRouteHandlerClient({ cookies })

    // Auth check
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: exchanges, error } = await supabase
      .from('exchanges')
      .select('*')
      .order('name')

    if (error) throw error

    return NextResponse.json(exchanges)
  } catch (error: any) {
    console.error('Error fetching exchanges:', error)
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    )
  }
}
