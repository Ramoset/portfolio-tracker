import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Usiamo il service role per scrivere nella cache (bypassa RLS)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const LCW_API_KEY = process.env.LCW_API_KEY!
const LCW_URL = 'https://api.livecoinwatch.com'
const BATCH_SIZE = 100 // LCW limite per /coins/map

// Stablecoin e fiat da escludere — non hanno bisogno di prezzo live
const SKIP_TICKERS = new Set([
  'USD', 'USDT', 'USDC', 'BUSD', 'DAI', 'TUSD', 'USDP', 'USDD',
  'EUR', 'GBP', 'CHF', 'JPY', 'AUD', 'CAD',
])

// Mappa ticker→lcw_code per coin con codici speciali (es. _SUI)
// Popolata dalla tabella coin_mappings in Supabase
async function getLcwCodeMap(): Promise<Map<string, string>> {
  const { data } = await supabaseAdmin
    .from('coin_mappings')
    .select('ticker, lcw_code')
  const map = new Map<string, string>()
  for (const row of data || []) {
    map.set(row.ticker.toUpperCase(), row.lcw_code)
  }
  return map
}

// Chiama LCW /coins/map con un batch di codici
async function fetchLcwBatch(codes: string[]): Promise<Map<string, number>> {
  const prices = new Map<string, number>()
  if (codes.length === 0) return prices

  try {
    const res = await fetch(`${LCW_URL}/coins/map`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': LCW_API_KEY,
      },
      body: JSON.stringify({
        codes,
        currency: 'USD',
        sort: 'rank',
        order: 'ascending',
        offset: 0,
        limit: 0, // 0 = usa la dimensione dell'array codes
        meta: false,
      }),
    })

    if (!res.ok) {
      console.error(`LCW error ${res.status}: ${await res.text()}`)
      return prices
    }

    const data: Array<{ code: string; rate: number }> = await res.json()
    for (const coin of data) {
      if (coin.rate && coin.rate > 0) {
        prices.set(coin.code.toUpperCase(), coin.rate)
      }
    }
  } catch (err) {
    console.error('LCW fetch error:', err)
  }

  return prices
}

export async function POST(request: Request) {
  // Protezione: solo chiamate interne o con secret header
  const authHeader = request.headers.get('x-cron-secret')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startTime = Date.now()

  try {
    // 1. Leggi tutti i ticker unici da TUTTE le transazioni di tutti gli utenti
    const { data: tickerRows, error: tickerError } = await supabaseAdmin
      .from('transactions')
      .select('ticker, price_currency, fees_currency, from_ticker, to_ticker')

    if (tickerError) throw tickerError

    // Raccogli tutti i ticker unici
    const allTickers = new Set<string>()
    for (const row of tickerRows || []) {
      if (row.ticker) allTickers.add(row.ticker.toUpperCase())
      if (row.price_currency) allTickers.add(row.price_currency.toUpperCase())
      if (row.from_ticker) allTickers.add(row.from_ticker.toUpperCase())
      if (row.to_ticker) allTickers.add(row.to_ticker.toUpperCase())
    }

    // Rimuovi stable e fiat
    const tickers = Array.from(allTickers).filter(t => !SKIP_TICKERS.has(t) && t.length > 0)

    if (tickers.length === 0) {
      return NextResponse.json({ message: 'Nessun ticker da aggiornare', updated: 0 })
    }

    // 2. Carica la mappa ticker→lcw_code (per coin con codici speciali)
    const codeMap = await getLcwCodeMap()

    // Converti i ticker nei codici LCW corretti
    const lcwCodes = tickers.map(t => codeMap.get(t) || t)

    // 3. Chiama LCW in batch da BATCH_SIZE
    const allPrices = new Map<string, number>() // lcw_code → price

    for (let i = 0; i < lcwCodes.length; i += BATCH_SIZE) {
      const batch = lcwCodes.slice(i, i + BATCH_SIZE)
      const batchPrices = await fetchLcwBatch(batch)
      for (const [code, price] of batchPrices) {
        allPrices.set(code, price)
      }
    }

    // 4. Riconverti i codici LCW nei ticker originali e prepara upsert
    const now = new Date().toISOString()
    const upsertRows: Array<{ ticker: string; price_usd: number; updated_at: string }> = []

    for (const ticker of tickers) {
      const lcwCode = codeMap.get(ticker) || ticker
      const price = allPrices.get(lcwCode) || allPrices.get(ticker)
      if (price && price > 0) {
        upsertRows.push({ ticker, price_usd: price, updated_at: now })
      }
    }

    // 5. Upsert nella cache (insert o update se già esiste)
    if (upsertRows.length > 0) {
      const { error: upsertError } = await supabaseAdmin
        .from('prices_cache')
        .upsert(upsertRows, { onConflict: 'ticker' })

      if (upsertError) throw upsertError
    }

    const elapsed = Date.now() - startTime
    console.log(`[prices/refresh] ${upsertRows.length}/${tickers.length} prezzi aggiornati in ${elapsed}ms`)

    return NextResponse.json({
      success: true,
      tickers_found: tickers.length,
      prices_updated: upsertRows.length,
      prices_missing: tickers.length - upsertRows.length,
      elapsed_ms: elapsed,
    })

  } catch (err: any) {
    console.error('[prices/refresh] Error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// GET per debug — mostra lo stato della cache
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('prices_cache')
    .select('*')
    .order('updated_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const oldest = data?.[data.length - 1]?.updated_at
  const newest = data?.[0]?.updated_at

  return NextResponse.json({
    cached_tickers: data?.length || 0,
    newest_update: newest,
    oldest_update: oldest,
    prices: data,
  })
}