'use client'

import { useEffect, useMemo, useState } from 'react'
import Papa from 'papaparse'

interface CSVImportProps {
  onClose: () => void
  onSuccess: () => void
}

type Wallet = {
  id: string
  name: string
  level: number
  parent_wallet_id: string | null
}

interface CSVRow {
  date: string
  action: string
  wallet?: string // ✅ OPTIONAL NOW - defaults to Portfolio
  ticker: string
  type?: string
  exchange: string
  quantity: string
  price: string
  currency: string
  fees: string // ✅ REQUIRED (can be "0")
  fees_currency?: string
  direction?: string
  leverage?: string
  notes?: string

  // Optional SWAP legacy fields (if action=SWAP)
  from_ticker?: string
  to_ticker?: string
}

const VALID_ACTIONS = ['BUY', 'SELL', 'DEPOSIT', 'WITHDRAWAL', 'SWAP', 'AIRDROP']

function toUpper(x: any): string {
  return String(x ?? '').trim().toUpperCase()
}

// Parse date and add timestamp if missing
function parseDateTime(dateStr: string): string {
  if (!dateStr) return new Date().toISOString()
  
  // If already has time component (contains T or :)
  if (dateStr.includes('T') || dateStr.includes(':')) {
    return new Date(dateStr).toISOString()
  }
  
  // Add 00:00:00 for date-only strings
  return new Date(dateStr + 'T00:00:00.000Z').toISOString()
}

export default function CSVImport({ onClose, onSuccess }: CSVImportProps) {
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string>('')

  const [wallets, setWallets] = useState<Wallet[]>([])
  const [walletsLoading, setWalletsLoading] = useState(true)
  const [defaultWalletId, setDefaultWalletId] = useState<string | null>(null)

  const [result, setResult] = useState<{
    imported: number
    skipped: number
    errors: Array<{ row: number; message: string }>
  } | null>(null)

  useEffect(() => {
    const loadWallets = async () => {
      try {
        setWalletsLoading(true)
        const res = await fetch('/api/wallets')
        if (!res.ok) throw new Error('Failed to load wallets')
        const data = await res.json()
        const ws: Wallet[] = data.wallets || []
        setWallets(ws)
        
        // Find "Portfolio" wallet as default
        const portfolio = ws.find(w => w.name.toLowerCase() === 'portfolio')
        if (portfolio) {
          setDefaultWalletId(portfolio.id)
        } else if (ws.length > 0) {
          // Fallback to first wallet
          setDefaultWalletId(ws[0].id)
        }
      } catch (e: any) {
        setError(e.message)
      } finally {
        setWalletsLoading(false)
      }
    }
    loadWallets()
  }, [])

  const walletMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const w of wallets) {
      map[toUpper(w.name)] = w.id
    }
    return map
  }, [wallets])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      if (!selectedFile.name.endsWith('.csv')) {
        setError('Please select a CSV file')
        return
      }
      setFile(selectedFile)
      setError(null)
      setResult(null)
    }
  }

  const validateRow = (row: CSVRow, rowNum: number): string | null => {
    if (!row.date) return `Row ${rowNum}: Missing date`
    if (!row.action) return `Row ${rowNum}: Missing action`
    if (!row.ticker) return `Row ${rowNum}: Missing ticker`
    if (!row.exchange) return `Row ${rowNum}: Missing exchange`

    const action = toUpper(row.action)
    if (!VALID_ACTIONS.includes(action)) {
      return `Row ${rowNum}: Invalid action '${row.action}'`
    }

    // numbers
    if (!row.quantity || isNaN(parseFloat(row.quantity))) return `Row ${rowNum}: Invalid quantity`
    if (!row.price || isNaN(parseFloat(row.price))) return `Row ${rowNum}: Invalid price`

    const q = parseFloat(row.quantity)
    const p = parseFloat(row.price)

    if (q <= 0) return `Row ${rowNum}: Quantity must be > 0`
    if (p < 0) return `Row ${rowNum}: Price must be >= 0`

    // fees is required (can be 0)
    if (row.fees === undefined || row.fees === null || row.fees === '') {
      return `Row ${rowNum}: Missing fees (put 0 if none)`
    }
    if (isNaN(parseFloat(row.fees))) return `Row ${rowNum}: Invalid fees`

    // currency required
    if (!row.currency) return `Row ${rowNum}: Missing currency`

    // SWAP legacy fields required only if action=SWAP
    if (action === 'SWAP') {
      if (!row.from_ticker) return `Row ${rowNum}: Missing from_ticker for SWAP`
      if (!row.to_ticker) return `Row ${rowNum}: Missing to_ticker for SWAP`
    }

    return null
  }

  const handleImport = async () => {
    if (!file) {
      setError('Please select a file')
      return
    }
    if (walletsLoading) {
      setError('Wallets are still loading, try again in a moment')
      return
    }
    if (wallets.length === 0) {
      setError('No wallets found. Create a wallet first.')
      return
    }
    if (!defaultWalletId) {
      setError('No default wallet found. Create a "Portfolio" wallet first.')
      return
    }

    setLoading(true)
    setError(null)
    setProgress('Reading file...')

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const rows = results.data as CSVRow[]
        const errors: Array<{ row: number; message: string }> = []
        let imported = 0
        let skipped = 0

        setProgress(`Found ${rows.length} rows. Validating...`)

        const validRows: Array<{ row: CSVRow; index: number }> = []

        rows.forEach((row, index) => {
          const rowNum = index + 2 // header is row 1
          const validationError = validateRow(row, rowNum)
          if (validationError) {
            errors.push({ row: rowNum, message: validationError })
            skipped++
          } else {
            validRows.push({ row, index: rowNum })
          }
        })

        if (validRows.length === 0) {
          setError('No valid rows found in CSV')
          setLoading(false)
          setProgress('')
          setResult({ imported: 0, skipped, errors: errors.slice(0, 10) })
          return
        }

        setProgress(`Validated. Importing ${validRows.length} transactions...`)

        const batchSize = 50
        const batches = []
        for (let i = 0; i < validRows.length; i += batchSize) {
          batches.push(validRows.slice(i, i + batchSize))
        }

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
          const batch = batches[batchIndex]
          setProgress(`Importing batch ${batchIndex + 1} of ${batches.length}...`)

          const promises = batch.map(async ({ row, index }) => {
            try {
              const action = toUpper(row.action)
              
              // Determine wallet: use wallet from CSV if exists, otherwise default
              let walletId = defaultWalletId
              if (row.wallet && row.wallet.trim()) {
                const csvWalletId = walletMap[toUpper(row.wallet)]
                if (csvWalletId) {
                  walletId = csvWalletId
                }
                // If wallet specified but not found, still use default (no error)
              }

              const feeCurrency = toUpper(row.fees_currency || row.currency || 'USDT')

              const payload = {
                date: parseDateTime(row.date), // ✅ Timestamp support
                action,
                ticker: toUpper(row.ticker),
                type: toUpper(row.type || 'CRYPTO'),
                quantity: parseFloat(row.quantity),
                price: parseFloat(row.price),
                price_currency: toUpper(row.currency || 'USDT'),
                exchange: row.exchange,
                wallet_id: walletId, // ✅ Always has value (default or from CSV)
                from_ticker: action === 'SWAP' ? toUpper(row.from_ticker) : null,
                to_ticker: action === 'SWAP' ? toUpper(row.to_ticker) : null,
                fees: parseFloat(row.fees || '0'),
                fees_currency: feeCurrency,
                direction: row.direction ? toUpper(row.direction) : null,
                leverage: row.leverage ? parseFloat(row.leverage) : null,
                notes: row.notes || null,
              }

              const res = await fetch('/api/transactions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              })

              if (!res.ok) {
                const data = await res.json().catch(() => ({}))
                throw new Error(data?.error || 'Failed to import')
              }

              imported++
            } catch (err: any) {
              errors.push({
                row: index,
                message: `Failed to import: ${err?.message || 'Unknown error'}`,
              })
              skipped++
            }
          })

          await Promise.all(promises)

          if (batchIndex < batches.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 300))
          }
        }

        setResult({
          imported,
          skipped,
          errors: errors.slice(0, 10),
        })

        setProgress('')
        setLoading(false)

        if (imported > 0) {
          setTimeout(() => onSuccess(), 1200)
        }
      },
      error: (err) => {
        setError(`Failed to parse CSV: ${err.message}`)
        setLoading(false)
        setProgress('')
      },
    })
  }

  const defaultWalletName = wallets.find(w => w.id === defaultWalletId)?.name || 'None'

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold">Import CSV</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">✕</button>
        </div>

        {!result ? (
          <>
            <div className="mb-6">
              <p className="text-sm text-gray-600 mb-2">
                CSV columns (wallet is optional - defaults to "{defaultWalletName}"):
              </p>
              <div className="bg-gray-50 p-3 rounded text-xs font-mono overflow-x-auto">
                date,action,ticker,type,exchange,quantity,price,currency,fees,fees_currency,wallet,notes,from_ticker,to_ticker
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Required: date, action, ticker, exchange, quantity, price, currency, fees
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Optional: wallet (defaults to "{defaultWalletName}"), type, fees_currency, notes
              </p>
              <p className="text-xs text-gray-500 mt-1">
                For SWAP only: from_ticker, to_ticker are required.
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Date format: YYYY-MM-DD or YYYY-MM-DD HH:MM:SS (adds 00:00:00 if time missing)
              </p>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                <p className="text-red-800 text-sm">{error}</p>
              </div>
            )}

            {progress && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                <p className="text-blue-800 text-sm">{progress}</p>
              </div>
            )}

            <div className="mb-4 bg-blue-50 border border-blue-200 rounded p-3">
              <p className="text-sm text-blue-900">
                <span className="font-semibold">Default wallet:</span> {defaultWalletName}
              </p>
              <p className="text-xs text-blue-700 mt-1">
                All imported transactions will be assigned to this wallet unless you specify a different wallet in the CSV.
              </p>
            </div>

            <div className="mb-4">
              <p className="text-xs text-gray-600">
                Available wallets: {walletsLoading ? 'Loading...' : wallets.map(w => w.name).join(', ') || 'None'}
              </p>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select CSV File
              </label>
              <input
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                disabled={loading}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-50"
              />
              {file && (
                <p className="text-sm text-gray-600 mt-2">
                  Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)
                </p>
              )}
            </div>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="px-4 py-2 rounded border hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={loading || !file || walletsLoading || !defaultWalletId}
                className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Importing...' : 'Import'}
              </button>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-green-800 text-sm">
                Imported: <b>{result.imported}</b> — Skipped: <b>{result.skipped}</b>
              </p>
              <p className="text-green-700 text-xs mt-1">
                All transactions assigned to: {defaultWalletName}
              </p>
            </div>

            {result.errors.length > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <p className="text-yellow-900 text-sm font-medium mb-2">First errors:</p>
                <ul className="text-xs text-yellow-900 space-y-1">
                  {result.errors.map((e, i) => (
                    <li key={i}>
                      Row {e.row}: {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded border hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

