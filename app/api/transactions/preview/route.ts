import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { transactions } = body

    if (!Array.isArray(transactions) || transactions.length === 0) {
      return NextResponse.json({ error: 'transactions array is required' }, { status: 400 })
    }

    // Get existing wallets
    const { data: existingWallets } = await supabase
      .from('wallets')
      .select('id, name, parent_wallet_id, level')
      .eq('user_id', user.id)
      .order('level', { ascending: true })
      .order('name', { ascending: true })

    const existingWalletNames = new Set(existingWallets?.map(w => w.name.toUpperCase()) || [])
    const existingWalletIds = new Set(existingWallets?.map(w => String(w.id).toUpperCase()) || [])

    // Find all unique wallet names/IDs in CSV
    const walletNamesInCsv = new Set<string>()
    
    for (const tx of transactions) {
      const walletValue =
        tx.wallet_id ??
        tx.wallet ??
        tx.wallet_name ??
        tx.walletId

      if (walletValue) {
        walletNamesInCsv.add(String(walletValue).toUpperCase())
      }
    }

    // Determine which wallets are new
    const newWallets: string[] = []
    
    for (const walletName of walletNamesInCsv) {
      // Check if it's an existing ID or name
      const isExistingId = existingWalletIds.has(walletName)
      const isExistingName = existingWalletNames.has(walletName)
      
      if (!isExistingId && !isExistingName) {
        newWallets.push(walletName)
      }
    }

    // Get root wallets for selection (backward compat) + all wallets for full select
    const rootWallets = existingWallets?.filter(w => w.parent_wallet_id === null) || []

    return NextResponse.json({
      newWallets: newWallets.sort(),
      rootWallets: rootWallets.map(w => ({ id: w.id, name: w.name })),
      allWallets: (existingWallets || []).map(w => ({ id: w.id, name: w.name, level: w.level ?? 0 })),
      totalTransactions: transactions.length,
      needsConfiguration: newWallets.length > 0
    })
  } catch (error: any) {
    console.error('Preview error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
