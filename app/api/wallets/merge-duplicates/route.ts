import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/wallets/merge-duplicates
 *
 * Trova tutti i wallet dell'utente con nomi duplicati (case-insensitive)
 * e li unifica: aggiorna le transazioni che puntano ai wallet secondari
 * affinché puntino al wallet primario (il più vecchio per created_at),
 * poi cancella i wallet duplicati.
 *
 * Restituisce: { groups_merged, wallets_deleted, transactions_updated }
 */
export async function POST() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // 1. Fetch tutti i wallet dell'utente
    const { data: wallets, error: walletsErr } = await supabase
      .from('wallets')
      .select('id, name, created_at, parent_wallet_id, level')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })

    if (walletsErr) throw walletsErr

    if (!wallets || wallets.length === 0) {
      return NextResponse.json({ groups_merged: 0, wallets_deleted: 0, transactions_updated: 0 })
    }

    // 2. Raggruppa per nome normalizzato (lowercase + trim)
    const groups = new Map<string, typeof wallets>()
    for (const w of wallets) {
      const key = String(w.name || '').toLowerCase().trim()
      if (!key) continue
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(w)
    }

    let groupsMerged = 0
    let walletsDeleted = 0
    let transactionsUpdated = 0

    // 3. Per ogni gruppo con >1 wallet: il primario è il più vecchio (primo in ordine created_at)
    for (const [, group] of groups.entries()) {
      if (group.length <= 1) continue

      const primary = group[0] // il più vecchio (order by created_at asc)
      const secondaries = group.slice(1)

      for (const secondary of secondaries) {
        // 4. Aggiorna tutte le transazioni che puntano al wallet secondario
        const { count, error: updateErr } = await supabase
          .from('transactions')
          .update({ wallet_id: primary.id })
          .eq('wallet_id', secondary.id)
          .eq('user_id', user.id)

        if (updateErr) {
          console.error(`Errore aggiornamento transazioni wallet ${secondary.id}:`, updateErr)
          continue
        }

        transactionsUpdated += count ?? 0

        // 5. Cancella il wallet secondario
        const { error: deleteErr } = await supabase
          .from('wallets')
          .delete()
          .eq('id', secondary.id)
          .eq('user_id', user.id)

        if (deleteErr) {
          console.error(`Errore cancellazione wallet ${secondary.id}:`, deleteErr)
          continue
        }

        walletsDeleted++
      }

      groupsMerged++
    }

    return NextResponse.json({
      groups_merged: groupsMerged,
      wallets_deleted: walletsDeleted,
      transactions_updated: transactionsUpdated,
      message: walletsDeleted === 0
        ? 'Nessun wallet duplicato trovato.'
        : `Unificati ${groupsMerged} gruppi: eliminati ${walletsDeleted} wallet duplicati, aggiornate ${transactionsUpdated} transazioni.`
    })
  } catch (error: any) {
    console.error('Errore merge wallet duplicati:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
