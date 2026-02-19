'use client'

import { useMemo, useState } from 'react'
import Papa from 'papaparse'

type Props = {
  onClose: () => void
  onSuccess: () => void
}

type ParsedRow = Record<string, string>

type PreviewResponse = {
  newWallets: string[]
  rootWallets: { id: string; name: string }[]
  totalTransactions: number
  needsConfiguration: boolean
}

type ImportProgress = {
  total: number
  processed: number
  success: number
  failed: number
  batch: number
  batches: number
  status: string
}

const CHUNK_SIZE = 250

function normalizeHeader(h: string) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
}

function cleanCell(v: string) {
  return String(v ?? '').trim()
}

function parseCSV(text: string): { headers: string[]; rows: ParsedRow[] } {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    // Auto-detect delimiter to support both "," and ";" exports.
    delimiter: '',
    delimitersToGuess: [',', ';', '\t', '|'],
  })

  const sourceHeaders = (parsed.meta.fields || []).map((h) => cleanCell(h || ''))
  const displayHeaders = [...sourceHeaders]
  if (displayHeaders.length > 0 && displayHeaders[0] === '') displayHeaders[0] = 'date'

  const used = new Set<string>()
  const headers = displayHeaders.map((raw, idx) => {
    let base = normalizeHeader(raw)
    if (!base) base = `col_${idx + 1}`
    let key = base
    let n = 2
    while (used.has(key)) {
      key = `${base}_${n}`
      n += 1
    }
    used.add(key)
    return key
  })

  const rows: ParsedRow[] = []
  for (const rawRow of parsed.data || []) {
    const row: ParsedRow = {}
    sourceHeaders.forEach((sourceHeader, idx) => {
      const normHeader = headers[idx]
      row[normHeader] = cleanCell((rawRow as any)?.[sourceHeader] ?? '')
    })
    const any = Object.values(row).some((v) => cleanCell(v).length > 0)
    if (any) rows.push(row)
  }

  return { headers, rows }
}

async function fetchJSON(url: string, init?: RequestInit) {
  const res = await fetch(url, init)
  const text = await res.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  if (!res.ok) {
    const msg = json?.error || json?.message || text || `HTTP ${res.status}`
    throw new Error(msg)
  }
  return json
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

export default function CSVImport({ onClose, onSuccess }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [rawText, setRawText] = useState<string>('')
  const [busy, setBusy] = useState(false)

  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [walletConfig, setWalletConfig] = useState<Record<string, string>>({})
  const [showConfigDialog, setShowConfigDialog] = useState(false)

  const [progress, setProgress] = useState<ImportProgress | null>(null)

  const parsed = useMemo(() => {
    if (!rawText) return { headers: [] as string[], rows: [] as ParsedRow[] }
    return parseCSV(rawText)
  }, [rawText])

  const previewRows = useMemo(() => parsed.rows.slice(0, 8), [parsed.rows])

  const onPickFile = async (f: File | null) => {
    setFile(f)
    setPreview(null)
    setWalletConfig({})
    setShowConfigDialog(false)
    setProgress(null)

    if (!f) {
      setRawText('')
      return
    }

    const text = await f.text()
    setRawText(text)
  }

  const buildTransactions = () => {
    return parsed.rows.map((row, index) => {
      const obj: any = {}
      parsed.headers.forEach((h) => {
        obj[h] = row[h] || ''
      })
      // Keep CSV source row for precise error reporting (header is row 1)
      obj.__row_num = index + 2
      return obj
    })
  }

  const runPreview = async () => {
    if (!parsed.rows.length) {
      alert('CSV vuoto')
      return
    }

    setBusy(true)
    let handedOffToImport = false

    try {
      const transactions = buildTransactions()

      const result = await fetchJSON('/api/transactions/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions }),
      })

      setPreview(result)

      if (result.needsConfiguration) {
        const defaultParent = result.rootWallets[0]?.id || null
        const config: Record<string, string> = {}
        result.newWallets.forEach((w: string) => {
          config[w] = defaultParent || ''
        })
        setWalletConfig(config)
        setShowConfigDialog(true)
        return
      }

      handedOffToImport = true
      await doImport({})
    } catch (e: any) {
      alert(`Preview failed: ${e.message}`)
    } finally {
      if (!handedOffToImport) setBusy(false)
    }
  }

  const doImport = async (config: Record<string, string>) => {
    if (!parsed.rows.length) return

    setBusy(true)
    let importBatchId: string | null = null
    try {
      const transactions = buildTransactions()
      const chunks = chunkArray(transactions, CHUNK_SIZE)

      const batchStart = await fetchJSON('/api/transactions/import-batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file?.name || null,
          total_rows: transactions.length,
        }),
      })
      importBatchId = String(batchStart?.batch?.id || '')
      if (!importBatchId) throw new Error('Impossibile iniziare la sessione di import')

      let totalSuccess = 0
      let totalFailed = 0
      const failedDetails: Array<{ row: number | null; error: string }> = []

      setProgress({
        total: transactions.length,
        processed: 0,
        success: 0,
        failed: 0,
        batch: 0,
        batches: chunks.length,
        status: 'Preparazione import...',
      })

      for (let i = 0; i < chunks.length; i++) {
        const batch = chunks[i]
        setProgress((prev) => ({
          total: prev?.total || transactions.length,
          processed: prev?.processed || 0,
          success: prev?.success || 0,
          failed: prev?.failed || 0,
          batch: i + 1,
          batches: chunks.length,
          status: `Import batch ${i + 1}/${chunks.length}...`,
        }))

        const result = await fetchJSON('/api/transactions/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transactions: batch,
            walletConfig: config,
            import_batch_id: importBatchId,
          }),
        })

        const success = Number(result?.summary?.success ?? result?.imported ?? 0)
        const failed = Number(result?.summary?.failed ?? result?.failed ?? 0)

        totalSuccess += success
        totalFailed += failed

        const failedRows = Array.isArray(result?.results)
          ? result.results.filter((r: any) => r?.status !== 'OK')
          : []
        for (const fr of failedRows) {
          const rowNumRaw = fr?.transaction?.__row_num
          const rowNum = Number.isFinite(Number(rowNumRaw)) ? Number(rowNumRaw) : null
          failedDetails.push({
            row: rowNum,
            error: String(fr?.error || 'Unknown error'),
          })
        }

        setProgress((prev) => ({
          total: prev?.total || transactions.length,
          processed: Math.min((i + 1) * CHUNK_SIZE, transactions.length),
          success: totalSuccess,
          failed: totalFailed,
          batch: i + 1,
          batches: chunks.length,
          status: `Completato batch ${i + 1}/${chunks.length}`,
        }))
      }

      setProgress((prev) => prev ? ({ ...prev, status: 'Import completato' }) : prev)

      await fetchJSON(`/api/transactions/import-batches/${importBatchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'completed',
          imported_count: totalSuccess,
          skipped_count: totalFailed,
        }),
      })

      const failPreview =
        failedDetails.length > 0
          ? `\n\nDettaglio errori:\n${failedDetails
              .slice(0, 8)
              .map((f) => `- Riga ${f.row ?? '?'}: ${f.error}`)
              .join('\n')}${failedDetails.length > 8 ? `\n... (+${failedDetails.length - 8} altri)` : ''}`
          : ''

      alert(`Import completato!\n✅ Success: ${totalSuccess}\n❌ Failed: ${totalFailed}${failPreview}`)

      if (totalSuccess > 0) {
        onSuccess()
        onClose()
      }
    } catch (e: any) {
      if (importBatchId) {
        try {
          await fetchJSON(`/api/transactions/import-batches/${importBatchId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: 'failed',
              error_message: e?.message || 'Import failed',
            }),
          })
        } catch {
          // noop
        }
      }
      alert(`Import failed: ${e.message}`)
    } finally {
      setBusy(false)
      setShowConfigDialog(false)
    }
  }

  const progressPct = progress ? Math.round((progress.processed / Math.max(progress.total, 1)) * 100) : 0

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
        <div className="w-full max-w-3xl rounded-2xl bg-white shadow-xl border border-gray-200">
          <div className="p-5 border-b flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold">Import CSV</div>
              <div className="text-xs text-gray-500">Carica CSV con transazioni - wallet mancanti verranno creati</div>
            </div>

            <button
              onClick={onClose}
              className="px-3 py-2 text-sm rounded border hover:bg-gray-50"
              disabled={busy}
            >
              Close
            </button>
          </div>

          <div className="p-5 space-y-4">
            <div className="flex flex-col gap-3">
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => onPickFile(e.target.files?.[0] || null)}
                disabled={busy}
                className="text-sm"
              />
              {file && (
                <span className="text-xs text-gray-600">{file.name} • {parsed.rows.length} transactions</span>
              )}
            </div>

            {progress && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
                <div className="flex items-center justify-between text-xs text-blue-900">
                  <span>{progress.status}</span>
                  <span className="font-semibold">{progressPct}%</span>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-blue-100">
                  <div
                    className="h-full rounded-full bg-blue-600 transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-blue-800">
                  <span>{progress.processed}/{progress.total} righe</span>
                  <span>✅ {progress.success} • ❌ {progress.failed}</span>
                </div>
              </div>
            )}

            {parsed.headers.length > 0 && (
              <div className="text-xs text-gray-500">
                Headers: <span className="font-mono">{parsed.headers.join(', ')}</span>
              </div>
            )}

            {previewRows.length > 0 && (
              <div className="border rounded-xl overflow-hidden">
                <div className="px-4 py-2 bg-gray-50 text-sm font-semibold">Preview (first 8 rows)</div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead className="bg-white border-b">
                      <tr>
                        {parsed.headers.slice(0, 10).map((h) => (
                          <th key={h} className="text-left px-3 py-2 font-semibold text-gray-600">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((r, idx) => (
                        <tr key={idx} className="border-b last:border-b-0">
                          {parsed.headers.slice(0, 10).map((h) => (
                            <td key={h} className="px-3 py-2 whitespace-nowrap">{r[h]}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex items-center justify-end">
              <button
                onClick={runPreview}
                className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                disabled={busy || !file || parsed.rows.length === 0}
              >
                {busy ? 'Processing...' : 'Import'}
              </button>
            </div>

            <details className="border rounded-xl p-4">
              <summary className="cursor-pointer text-sm font-semibold text-gray-700">Formato CSV supportato</summary>
              <div className="mt-3 space-y-2 text-xs text-gray-600">
                <div className="font-mono bg-gray-50 p-2 rounded border overflow-auto">
                  date;action;ticker;wallet;exchange;quantity;price;price_currency;fees;fees_currency;direction;leverage;from_ticker;to_ticker;notes
                </div>
                <div className="mt-2">
                  Supporta separatori <strong>;</strong> e <strong>,</strong>.
                  <br />
                  <strong>wallet</strong> può essere il nome del wallet (es. "LARGE CAP", "100x"). Se non esiste verrà creato.
                </div>
              </div>
            </details>
          </div>
        </div>
      </div>

      {showConfigDialog && preview && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl border border-gray-200">
            <div className="p-5 border-b">
              <div className="text-lg font-semibold">Configure New Wallets</div>
              <div className="text-sm text-gray-600 mt-1">Questi wallet non esistono. Scegli il parent wallet per ognuno:</div>
            </div>

            <div className="p-5 space-y-3 max-h-96 overflow-y-auto">
              {preview.newWallets.map((walletName) => (
                <div key={walletName} className="flex items-center gap-3 p-3 border rounded-lg">
                  <div className="flex-1">
                    <div className="font-semibold text-sm">{walletName}</div>
                    <div className="text-xs text-gray-500">New wallet</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">Parent:</span>
                    <select
                      className="text-sm border rounded px-3 py-2 min-w-[200px]"
                      value={walletConfig[walletName] || ''}
                      onChange={(e) => setWalletConfig((prev) => ({ ...prev, [walletName]: e.target.value }))}
                    >
                      <option value="">-- Select parent --</option>
                      {preview.rootWallets.map((root) => (
                        <option key={root.id} value={root.id}>{root.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-5 border-t flex items-center justify-end gap-3">
              <button
                onClick={() => setShowConfigDialog(false)}
                className="px-4 py-2 text-sm rounded border hover:bg-gray-50"
                disabled={busy}
              >
                Cancel
              </button>
              <button
                onClick={() => doImport(walletConfig)}
                className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                disabled={busy || Object.values(walletConfig).some((v) => !v)}
              >
                {busy ? 'Importing...' : 'Confirm & Import'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
