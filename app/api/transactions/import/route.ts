import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type ImportRow = Record<string, any>

function normalizeStr(v: any) {
  return (v ?? '').toString().trim()
}
function upper(v: any) {
  return normalizeStr(v).toUpperCase()
}
function normalizeAction(rawAction: any, rawDirection: any): string {
  const action = upper(rawAction)
  const direction = upper(rawDirection || 'LONG')
  if (action === 'CLOSE') return direction === 'SHORT' ? 'BUY' : 'SELL'
  if (action === 'OPEN') return direction === 'SHORT' ? 'SELL' : 'BUY'
  return action
}
const FIAT_STABLECOINS = new Set(['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'FDUSD'])
function isFiatOrStablecoin(ticker: string) {
  return FIAT_STABLECOINS.has(String(ticker || '').toUpperCase())
}
/** Parse number from various CSV formats. Returns { value, hadError } to track parse failures. */
function toNum(v: any): number {
  const raw = (v ?? '').toString().trim()
  if (raw === '') return 0
  // Support:
  // - "1234.56" (US)
  // - "1,234.56" (US with thousands)
  // - "1234,56" (EU)
  // - "1.234,56" (EU with thousands)
  let normalized = raw.replace(/\s/g, '')
  const hasComma = normalized.includes(',')
  const hasDot = normalized.includes('.')

  if (hasComma && hasDot) {
    // Assume the right-most separator is decimal; remove the other as thousand sep.
    if (normalized.lastIndexOf(',') > normalized.lastIndexOf('.')) {
      normalized = normalized.replace(/\./g, '').replace(',', '.')
    } else {
      normalized = normalized.replace(/,/g, '')
    }
  } else if (hasComma) {
    normalized = normalized.replace(',', '.')
  }

  const n = parseFloat(normalized)
  if (!Number.isFinite(n)) {
    console.warn(`[CSV import] Could not parse number: "${raw}", defaulting to 0`)
    return 0
  }
  return n
}

function parseDateToIso(v: any): string | null {
  const raw = normalizeStr(v)
  if (!raw) return null

  // Custom CSV format: dd/MM/yyyy H.mm.ss (also accepts ":" between time parts)
  // Interpret as local time to match manual entry/UI expectations.
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2})[.:](\d{1,2})[.:](\d{1,2})$/)
  if (m) {
    const day = Number(m[1])
    const month = Number(m[2])
    const year = Number(m[3])
    const hour = Number(m[4])
    const minute = Number(m[5])
    const second = Number(m[6])

    const dt = new Date(year, month - 1, day, hour, minute, second)
    const valid =
      dt.getFullYear() === year &&
      dt.getMonth() === month - 1 &&
      dt.getDate() === day &&
      dt.getHours() === hour &&
      dt.getMinutes() === minute &&
      dt.getSeconds() === second

    if (valid) return dt.toISOString()
  }

  // Backward compatibility: ISO and browser-parseable date strings
  const parsed = new Date(raw)
  if (Number.isFinite(parsed.getTime())) {
    return parsed.toISOString()
  }

  return null
}

function sanitizeFees(quantity: number, price: number, fees: number) {
  if (!Number.isFinite(fees) || fees <= 0) return 0
  const notional = (Number.isFinite(quantity) ? quantity : 0) * (Number.isFinite(price) ? price : 0)
  // Safety net for malformed CSV column-shift cases:
  // realistic trading fees should never be multiple times the notional.
  if (notional > 0 && fees > notional * 2) return 0
  return fees
}

function extractDateRaw(tx: ImportRow): string {
  const direct = normalizeStr(tx.date || tx.datetime || tx.timestamp)
  if (direct) return direct

  // Some CSV files may have an empty first header (e.g. ",action,ticker,...")
  // so date lands under key '' after parsing.
  const emptyHeaderDate = normalizeStr(tx[''])
  if (emptyHeaderDate) return emptyHeaderDate

  // Fallback: scan row values and pick first value matching supported date formats.
  for (const value of Object.values(tx || {})) {
    const candidate = normalizeStr(value)
    if (!candidate) continue
    if (parseDateToIso(candidate)) return candidate
  }

  return ''
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  }

  const userId = user.id


  try {
    const body = await request.json()
    const rows: ImportRow[] = body?.rows || body?.data || body?.transactions || []
    const importBatchId = normalizeStr(body?.import_batch_id) || null

    // Optional mapping: walletNameUpper -> parentWalletId
    const walletConfig: Record<string, string> = body?.walletConfig || {}

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'No rows provided' }, { status: 400 })
    }

    const skipDuplicates: boolean = body?.skipDuplicates === true

    const results: any[] = []
    const walletCache = new Map<string, { id: string; name: string; level?: number }>() // key: wallet string upper

    // Pre-load existing transaction fingerprints for deduplication (date+action+ticker+exchange)
    const existingFingerprints = new Set<string>()
    if (skipDuplicates) {
      const { data: existingTxs } = await supabase
        .from('transactions')
        .select('date, action, ticker, exchange, quantity')
        .eq('user_id', userId)
      for (const t of existingTxs || []) {
        const fp = `${t.date}|${t.action}|${t.ticker}|${String(t.exchange || '').trim()}|${Number(t.quantity).toFixed(8)}`
        existingFingerprints.add(fp)
      }
    }

    // Helpers
    async function getWalletByNameOrId(walletStr: string) {
      const key = upper(walletStr)
      if (!key) return null

      if (walletCache.has(key)) return walletCache.get(key) || null

      // 1) by name
      const { data: byName } = await supabase
        .from('wallets')
        .select('id,name,level,parent_wallet_id')
        .eq('user_id', userId)
        .ilike('name', walletStr)
        .maybeSingle()

      if (byName?.id) {
        walletCache.set(key, byName)
        return byName
      }

      // 2) by id
      const { data: byId } = await supabase
        .from('wallets')
        .select('id,name,level,parent_wallet_id')
        .eq('id', walletStr)
        .eq('user_id', userId)
        .maybeSingle()

      if (byId?.id) {
        walletCache.set(key, byId)
        return byId
      }

      return null
    }

    async function createWalletIfMissing(walletStr: string) {
      const key = upper(walletStr)
      if (!key) return null

      const existing = await getWalletByNameOrId(walletStr)
      if (existing) return existing

      const parentWalletId = walletConfig?.[key] || null

      let computedLevel = 0
      if (parentWalletId) {
        const { data: parentWallet } = await supabase
          .from('wallets')
          .select('level')
          .eq('id', parentWalletId)
          .eq('user_id', userId)
          .maybeSingle()

        computedLevel = (parentWallet?.level ?? 0) + 1
      }

      const { data: newWallet, error: createErr } = await supabase
        .from('wallets')
        .insert({
          user_id: userId,
          name: walletStr,
          parent_wallet_id: parentWalletId,
          level: computedLevel,
        })
        .select('id,name,level,parent_wallet_id')
        .single()

      if (createErr || !newWallet) return null

      walletCache.set(key, newWallet)
      return newWallet
    }

    for (const tx of rows) {
      try {
        // Accept multiple CSV formats
        const dateRaw = extractDateRaw(tx)
        const action = normalizeAction(tx.action, tx.direction)
        const ticker = upper(tx.ticker)
        const walletStr = normalizeStr(tx.wallet || tx.wallet_name || tx.walletId || tx.wallet_id)
        const parsedDateIso = parseDateToIso(dateRaw)
        const isFunding = action === 'DEPOSIT' || action === 'WITHDRAWAL'
        const walletOptionalForThisRow = isFunding && !isFiatOrStablecoin(ticker)

        if (!dateRaw || !action || !ticker) {
          results.push({ status: 'FAIL', error: 'Missing required fields (date/action/ticker)', transaction: tx })
          continue
        }

        if (!parsedDateIso) {
          results.push({ status: 'FAIL', error: 'Invalid date format. Supported: dd/MM/yyyy H.mm.ss or ISO', transaction: tx })
          continue
        }

        if (!walletStr && !walletOptionalForThisRow) {
          results.push({ status: 'FAIL', error: 'Missing required field: wallet', transaction: tx })
          continue
        }

        let wallet: { id: string; name: string } | null = null
        if (walletStr) {
          wallet = await createWalletIfMissing(walletStr)
          if (!wallet?.id) {
            results.push({ status: 'FAIL', error: `Wallet not found and could not be created: ${walletStr}`, transaction: tx })
            continue
          }
        }

        const payload: any = {
          quantity: toNum(tx.quantity),
          // DB schema requires NOT NULL price; for actions like deposit/withdrawal/airdrop we store 0 when missing.
          price: tx.price === '' || tx.price === null || tx.price === undefined ? 0 : toNum(tx.price),
        }

        const safeFees = sanitizeFees(payload.quantity, payload.price, toNum(tx.fees))

        Object.assign(payload, {
          user_id: userId,
          import_batch_id: importBatchId,
          wallet_id: wallet?.id || null,
          date: parsedDateIso,
          action,
          ticker,
          type: 'CRYPTO',
          price_currency: tx.price_currency ? upper(tx.price_currency) : (tx.currency ? upper(tx.currency) : null),
          fees: safeFees,
          fees_currency: tx.fees_currency ? upper(tx.fees_currency) : null,
          exchange: normalizeStr(tx.exchange) || null,
          notes: normalizeStr(tx.notes) || null,
          from_ticker: tx.from_ticker ? upper(tx.from_ticker) : null,
          to_ticker: tx.to_ticker ? upper(tx.to_ticker) : null,
          direction: tx.direction ? upper(tx.direction) : null,
          leverage: tx.leverage === '' || tx.leverage === null || tx.leverage === undefined ? null : toNum(tx.leverage),
        })

        // Deduplication check: salta se esiste già una transazione identica
        if (skipDuplicates) {
          const fp = `${payload.date}|${payload.action}|${payload.ticker}|${String(payload.exchange || '').trim()}|${Number(payload.quantity).toFixed(8)}`
          if (existingFingerprints.has(fp)) {
            results.push({ status: 'SKIP', reason: 'duplicate', action, ticker })
            continue
          }
        }

        // If DEPOSIT/WITHDRAWAL without price, keep null (DB should allow it; if not, we can force 0)
        const { error: insErr } = await supabase.from('transactions').insert(payload)
        if (insErr) {
          results.push({ status: 'FAIL', error: insErr.message, transaction: tx })
        } else {
          results.push({ status: 'OK', wallet: wallet?.name || null, action, ticker })
        }
      } catch (e: any) {
        results.push({ status: 'FAIL', error: e?.message || 'Unknown error', transaction: tx })
      }
    }

    const imported = results.filter(r => r.status === 'OK').length
    const skipped = results.filter(r => r.status === 'SKIP').length
    const failed = results.filter(r => r.status === 'FAIL').length

    if (importBatchId) {
      const { data: batchRow } = await supabase
        .from('import_batches')
        .select('id,imported_count,skipped_count')
        .eq('id', importBatchId)
        .eq('user_id', userId)
        .maybeSingle()

      if (batchRow?.id) {
        await supabase
          .from('import_batches')
          .update({
            imported_count: Number(batchRow.imported_count || 0) + imported,
            skipped_count: Number(batchRow.skipped_count || 0) + failed,
          })
          .eq('id', importBatchId)
          .eq('user_id', userId)
      }
    }

    return NextResponse.json({
      imported,
      skipped,
      failed,
      import_batch_id: importBatchId,
      summary: { success: imported, skipped, failed },
      results,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 })
  }
}
