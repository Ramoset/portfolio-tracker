import { NextResponse } from 'next/server'
import { createApiClient } from '@/lib/supabase/route'

export async function POST(request: Request) {
  const supabase = createApiClient()
  await supabase.auth.signOut()

  const origin = new URL(request.url).origin
  return NextResponse.redirect(new URL('/', origin))
}
