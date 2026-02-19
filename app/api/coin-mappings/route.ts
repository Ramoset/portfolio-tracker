import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

// GET /api/coin-mappings — lista tutti i mapping + ticker attivi nelle transazioni
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Tutti i mapping esistenti
  const { data: mappings, error: mErr } = await admin
    .from('coin_mappings')
    .select('ticker, lcw_code, name, png_url')
    .order('ticker')

  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 })

  // Ticker unici dalle transazioni dell'utente (escludi stables)
  const STABLES = new Set(['USD', 'USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'USDP', 'GUSD', 'EUR', 'GBP', 'CHF'])
  const { data: txTickers } = await supabase
    .from('transactions')
    .select('ticker, from_ticker, to_ticker')
    .eq('user_id', user.id)

  const activeTickers = new Set<string>()
  for (const t of txTickers || []) {
    if (t.ticker) activeTickers.add(t.ticker.toUpperCase())
    if (t.from_ticker) activeTickers.add(t.from_ticker.toUpperCase())
    if (t.to_ticker) activeTickers.add(t.to_ticker.toUpperCase())
  }
  // Rimuovi stables
  for (const s of STABLES) activeTickers.delete(s)

  // Prezzi cache per vedere quali hanno prezzi live
  const { data: priceRows } = await admin
    .from('prices_cache')
    .select('ticker, price_usd, updated_at')

  const pricesMap = new Map<string, { price: number; updated_at: string }>()
  for (const p of priceRows || []) {
    pricesMap.set(p.ticker.toUpperCase(), { price: Number(p.price_usd), updated_at: p.updated_at })
  }

  const mappingsMap = new Map((mappings || []).map(m => [m.ticker.toUpperCase(), m]))

  // Costruisci risposta combinata
  const rows = Array.from(activeTickers)
    .sort()
    .map(ticker => {
      const mapping = mappingsMap.get(ticker)
      const priceInfo = pricesMap.get(ticker)
      return {
        ticker,
        lcw_code: mapping?.lcw_code ?? null,
        name: mapping?.name ?? null,
        png_url: mapping?.png_url ?? null,
        has_mapping: !!mapping,
        has_price: !!priceInfo,
        price_usd: priceInfo?.price ?? null,
        price_updated_at: priceInfo?.updated_at ?? null,
      }
    })

  // Aggiungi anche i mapping che non sono nelle transazioni dell'utente (mappings orfani)
  const orphans = (mappings || [])
    .filter(m => !activeTickers.has(m.ticker.toUpperCase()))
    .map(m => ({
      ticker: m.ticker.toUpperCase(),
      lcw_code: m.lcw_code,
      name: m.name,
      png_url: m.png_url,
      has_mapping: true,
      has_price: pricesMap.has(m.ticker.toUpperCase()),
      price_usd: pricesMap.get(m.ticker.toUpperCase())?.price ?? null,
      price_updated_at: pricesMap.get(m.ticker.toUpperCase())?.updated_at ?? null,
    }))

  return NextResponse.json({ rows: [...rows, ...orphans] })
}

// POST /api/coin-mappings — upsert un mapping
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const ticker = String(body.ticker || '').toUpperCase().trim()
  const lcw_code = String(body.lcw_code || '').trim()
  const name = String(body.name || '').trim() || null
  const png_url = String(body.png_url || '').trim() || null

  if (!ticker) return NextResponse.json({ error: 'ticker obbligatorio' }, { status: 400 })
  if (!lcw_code) return NextResponse.json({ error: 'lcw_code obbligatorio' }, { status: 400 })

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { error } = await admin
    .from('coin_mappings')
    .upsert({ ticker, lcw_code, name, png_url }, { onConflict: 'ticker' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true }, { status: 201 })
}