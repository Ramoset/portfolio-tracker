import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Dopo quanti secondi un prezzo è considerato "vecchio"
const STALE_THRESHOLD_SECONDS = 120

export async function GET(request: Request) {
  const supabase = await createClient()

  // Autenticazione utente
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const tickersParam = searchParams.get('tickers')

  try {
    let query = supabase
      .from('prices_cache')
      .select('ticker, price_usd, updated_at')

    // Se vengono passati ticker specifici, filtra (es. ?tickers=BTC,ETH,SOL)
    if (tickersParam) {
      const tickers = tickersParam.split(',').map(t => t.trim().toUpperCase()).filter(Boolean)
      query = query.in('ticker', tickers)
    }

    const { data, error } = await query.order('ticker')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const now = Date.now()
    const prices: Record<string, number> = {}
    const stale: string[] = []
    const missing: string[] = []

    for (const row of data || []) {
      prices[row.ticker] = Number(row.price_usd)
      const ageSeconds = (now - new Date(row.updated_at).getTime()) / 1000
      if (ageSeconds > STALE_THRESHOLD_SECONDS) {
        stale.push(row.ticker)
      }
    }

    // Identifica ticker richiesti ma mancanti dalla cache
    if (tickersParam) {
      const requested = tickersParam.split(',').map(t => t.trim().toUpperCase())
      for (const t of requested) {
        if (!(t in prices)) missing.push(t)
      }
    }

    // Trova il timestamp dell'aggiornamento più recente
    const latestUpdate = data?.length
      ? data.reduce((latest, row) =>
          new Date(row.updated_at) > new Date(latest) ? row.updated_at : latest,
          data[0].updated_at
        )
      : null

    return NextResponse.json({
      prices,                          // { BTC: 98420, ETH: 2340, SOL: 185 }
      meta: {
        count: Object.keys(prices).length,
        last_updated: latestUpdate,
        stale_tickers: stale,          // ticker con prezzo > 2 min
        missing_tickers: missing,      // ticker richiesti ma non in cache
      }
    })

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}