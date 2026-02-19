import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

const LCW_API_KEY = process.env.LCW_API_KEY
const LCW_URL = 'https://api.livecoinwatch.com'
const BATCH_SIZE = 100

const SKIP_TICKERS = new Set([
  'USD', 'USDT', 'USDC', 'BUSD', 'DAI', 'TUSD', 'USDP', 'USDD',
  'EUR', 'GBP', 'CHF', 'JPY', 'AUD', 'CAD', 'FDUSD', 'GUSD'
])

function normalizeCode(code: string): string {
  return String(code || '').toUpperCase().trim()
}

function stripLeadingUnderscores(code: string): string {
  const c = normalizeCode(code)
  return c.replace(/^_+/, '')
}

async function fetchLcwBatch(codes: string[]): Promise<Map<string, number>> {
  const prices = new Map<string, number>()
  if (codes.length === 0) return prices

  const res = await fetch(`${LCW_URL}/coins/map`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': LCW_API_KEY || '',
    },
    body: JSON.stringify({
      codes,
      currency: 'USD',
      sort: 'rank',
      order: 'ascending',
      offset: 0,
      limit: 0,
      meta: false,
    }),
  })

  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`LCW error ${res.status}: ${txt}`)
  }

  const data: Array<{ code: string; rate: number }> = await res.json()
  for (const coin of data) {
    if (coin.rate && coin.rate > 0) {
      prices.set(String(coin.code || '').toUpperCase(), coin.rate)
    }
  }

  return prices
}

async function getLcwCodeMap(admin: any): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const { data } = await admin.from('coin_mappings').select('ticker, lcw_code')
  for (const row of data || []) {
    const ticker = String(row.ticker || '').toUpperCase().trim()
    const lcwCode = String(row.lcw_code || '').toUpperCase().trim()
    if (ticker && lcwCode) map.set(ticker, lcwCode)
  }
  return map
}

export async function POST() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!LCW_API_KEY) {
    return NextResponse.json({ error: 'LCW_API_KEY mancante' }, { status: 500 })
  }

  try {
    const { data: tickerRows, error: txErr } = await supabase
      .from('transactions')
      .select('ticker, price_currency, fees_currency, from_ticker, to_ticker')
      .eq('user_id', user.id)

    if (txErr) throw txErr

    const allTickers = new Set<string>()
    for (const row of tickerRows || []) {
      if (row.ticker) allTickers.add(String(row.ticker).toUpperCase())
      if (row.price_currency) allTickers.add(String(row.price_currency).toUpperCase())
      if (row.fees_currency) allTickers.add(String(row.fees_currency).toUpperCase())
      if (row.from_ticker) allTickers.add(String(row.from_ticker).toUpperCase())
      if (row.to_ticker) allTickers.add(String(row.to_ticker).toUpperCase())
    }

    const tickers = Array.from(allTickers).filter(t => !SKIP_TICKERS.has(t) && t.length > 0)
    if (tickers.length === 0) {
      return NextResponse.json({ success: true, updated: 0, total: 0 })
    }

    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const codeMap = await getLcwCodeMap(admin)
    const lcwCodesSet = new Set<string>()
    for (const ticker of tickers) {
      const mapped = codeMap.get(ticker)
      if (mapped) {
        lcwCodesSet.add(normalizeCode(mapped))
        continue
      }

      // Automatic mode:
      // 1) Try exact ticker code first (keeps leading underscores like _SUPRA)
      // 2) Add fallback without leading underscores for compatibility
      const exact = normalizeCode(ticker)
      const stripped = stripLeadingUnderscores(ticker)
      if (exact) lcwCodesSet.add(exact)
      if (stripped && stripped !== exact) lcwCodesSet.add(stripped)
    }
    const lcwCodes = Array.from(lcwCodesSet)

    const allPrices = new Map<string, number>()
    for (let i = 0; i < lcwCodes.length; i += BATCH_SIZE) {
      const batch = lcwCodes.slice(i, i + BATCH_SIZE)
      const batchPrices = await fetchLcwBatch(batch)
      for (const [code, price] of batchPrices) {
        allPrices.set(code, price)
      }
    }

    const now = new Date().toISOString()
    const upsertRows: Array<{ ticker: string; price_usd: number; updated_at: string }> = []

    for (const ticker of tickers) {
      const mapped = codeMap.get(ticker)
      const exact = mapped ? normalizeCode(mapped) : normalizeCode(ticker)
      const stripped = mapped ? exact : stripLeadingUnderscores(ticker)

      // Priority: exact code > stripped fallback
      const price = allPrices.get(exact) ?? (stripped !== exact ? allPrices.get(stripped) : undefined)
      if (price && price > 0) {
        upsertRows.push({ ticker, price_usd: price, updated_at: now })
      }
    }

    if (upsertRows.length > 0) {
      const { error: upsertErr } = await admin
        .from('prices_cache')
        .upsert(upsertRows, { onConflict: 'ticker' })

      if (upsertErr) throw upsertErr
    }

    return NextResponse.json({
      success: true,
      updated: upsertRows.length,
      total: tickers.length,
      missing: tickers.length - upsertRows.length,
    })
  } catch (err: any) {
    console.error('Price refresh error:', err)
    return NextResponse.json({ error: err?.message || 'Price refresh failed' }, { status: 500 })
  }
}
