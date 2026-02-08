import { cookies } from 'next/headers'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import type { Database } from '@/lib/types/database.types'

export function createApiClient() {
  return createRouteHandlerClient<Database>({ cookies })
}
