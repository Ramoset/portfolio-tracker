'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { formatCurrency } from '@/lib/utils'
import TransactionForm from './TransactionForm'
import CSVImport from './CSVImport'
import { TransactionsToolbar } from './TransactionsToolbar'

interface Transaction {
  id: string
  date: string
  action: string
  direction?: string | null
  leverage?: number | null
  ticker: string
  quantity: number
  price: number
  price_currency: string
  exchange: string
  wallet_id: string | null
  wallet_name?: string
  fees: number
  fees_currency: string
  notes: string | null
}

interface Wallet {
  id: string
  name: string
  parent_wallet_id?: string | null
}

interface PaginationMeta {
  page: number
  limit: number
  total: number
  totalPages: number
}

interface ImportBatch {
  id: string
  filename: string | null
  total_rows: number | null
  imported_count: number
  skipped_count: number
  status: string
  error_message: string | null
  created_at: string
}

const FIAT_STABLECOINS = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'FDUSD']
const PAGE_LIMIT = 100

function formatDateTime(isoString: string): string {
  const date = new Date(isoString)
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  const hours = String(date.getHours())
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${day}/${month}/${year} ${hours}.${minutes}.${seconds}`
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [pagination, setPagination] = useState<PaginationMeta>({ page: 1, limit: PAGE_LIMIT, total: 0, totalPages: 1 })
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editData, setEditData] = useState<Partial<Transaction>>({})
  const [saving, setSaving] = useState(false)
  const [clearingAll, setClearingAll] = useState(false)
  const [exportingMode, setExportingMode] = useState<'ALL' | 'FILTERED' | null>(null)
  const [findingDuplicates, setFindingDuplicates] = useState(false)
  const [duplicateCandidateIds, setDuplicateCandidateIds] = useState<string[]>([])
  const [undoingLastImport, setUndoingLastImport] = useState(false)
  const [showImportHistory, setShowImportHistory] = useState(false)
  const [loadingImportHistory, setLoadingImportHistory] = useState(false)
  const [importHistory, setImportHistory] = useState<ImportBatch[]>([])
  const [deletingImportBatchId, setDeletingImportBatchId] = useState<string | null>(null)

  // Toolbar filters (UI only)
  const [search, setSearch] = useState('')
  const [tickerFilter, setTickerFilter] = useState('')
  const [exchangeFilter, setExchangeFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('ALL')
  const [walletFilter, setWalletFilter] = useState('ALL')
  const [pageJumpInput, setPageJumpInput] = useState('1')

  // Inline warning popover (quick-fix wallet assignment)
  const [warningTxId, setWarningTxId] = useState<string | null>(null)
  const [warningSelectedWalletId, setWarningSelectedWalletId] = useState<string>('')
  const [warningSaving, setWarningSaving] = useState(false)
  const warningPopoverRef = useRef<HTMLDivElement | null>(null)

  // New wallet creation in edit mode
  const [showNewWalletInEdit, setShowNewWalletInEdit] = useState(false)
  const [newWalletName, setNewWalletName] = useState('')
  const [newWalletParent, setNewWalletParent] = useState<string>('')
  const [creatingWallet, setCreatingWallet] = useState(false)

  useEffect(() => {
    loadWallets()
  }, [])

  useEffect(() => {
    loadTransactions(1)
  }, [search, tickerFilter, exchangeFilter, actionFilter, walletFilter])

  useEffect(() => {
    setPageJumpInput(String(pagination.page || 1))
  }, [pagination.page])

  // Close warning popover on outside click
  useEffect(() => {
    if (!warningTxId) return

    const onMouseDown = (e: MouseEvent) => {
      const el = warningPopoverRef.current
      if (!el) return
      if (e.target instanceof Node && !el.contains(e.target)) {
        setWarningTxId(null)
        setWarningSelectedWalletId('')
      }
    }

    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [warningTxId])

  const loadTransactions = async (page?: number) => {
    const targetPage = page ?? pagination.page ?? 1
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('page', String(targetPage))
      params.set('limit', String(PAGE_LIMIT))
      if (search.trim()) params.set('q', search.trim())
      if (tickerFilter.trim()) params.set('ticker', tickerFilter.trim())
      if (exchangeFilter.trim()) params.set('exchange', exchangeFilter.trim())
      if (actionFilter !== 'ALL') params.set('action', actionFilter)
      if (walletFilter !== 'ALL') params.set('wallet', walletFilter)

      const res = await fetch(`/api/transactions?${params.toString()}`)
      const data = await res.json()

      const nextPagination: PaginationMeta = {
        page: data?.pagination?.page || targetPage,
        limit: data?.pagination?.limit || PAGE_LIMIT,
        total: data?.pagination?.total || 0,
        totalPages: Math.max(1, data?.pagination?.totalPages || 1),
      }

      // If current page is out of bounds after deletes/imports, reload the last valid page.
      if (targetPage > nextPagination.totalPages) {
        await loadTransactions(nextPagination.totalPages)
        return
      }

      setTransactions(data.transactions || [])
      setPagination(nextPagination)
    } catch (error) {
      console.error('Failed to load transactions:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadWallets = async () => {
    try {
      const res = await fetch('/api/wallets')
      const data = await res.json()
      setWallets(data.wallets || [])
    } catch (error) {
      console.error('Failed to load wallets:', error)
    }
  }

  const suggestions = useMemo(() => {
    const tickersMap = new Map<string, boolean>()
    const currenciesMap = new Map<string, boolean>()
    const exchangesMap = new Map<string, boolean>()

    transactions.forEach(tx => {
      if (tx.ticker) tickersMap.set(tx.ticker.toUpperCase(), true)
      if (tx.price_currency) currenciesMap.set(tx.price_currency.toUpperCase(), true)
      if (tx.fees_currency) currenciesMap.set(tx.fees_currency.toUpperCase(), true)
      if (tx.exchange) exchangesMap.set(tx.exchange, true)
    })

    return {
      tickers: Array.from(tickersMap.keys()),
      currencies: Array.from(currenciesMap.keys()),
      exchanges: Array.from(exchangesMap.keys()),
    }
  }, [transactions])

  // Wallet options for toolbar (unique names)
  const walletOptions = useMemo(() => {
    const set = new Set<string>()
    wallets.forEach(w => set.add(w.name))
    transactions.forEach(tx => {
      if (tx.wallet_name) set.add(tx.wallet_name)
    })
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [wallets, transactions])

  const searchSuggestions = useMemo(() => {
    const set = new Set<string>()
    suggestions.tickers.forEach(v => set.add(v))
    suggestions.exchanges.forEach(v => set.add(v))
    walletOptions.forEach(v => set.add(v))
    transactions.forEach(tx => {
      if (tx.notes) set.add(tx.notes)
      if (tx.price_currency) set.add(tx.price_currency)
      if (tx.fees_currency) set.add(tx.fees_currency)
      if (tx.action) set.add(tx.action)
    })
    return Array.from(set).filter(Boolean).sort((a, b) => a.localeCompare(b))
  }, [suggestions, walletOptions, transactions])

  const filteredTransactions = transactions

  const isFiatOrStablecoin = (ticker: string): boolean => {
    return FIAT_STABLECOINS.includes(ticker.toUpperCase())
  }

  const shouldHidePriceForEdit = (): boolean => {
    if (!editData.action) return false
    return ['DEPOSIT', 'WITHDRAWAL', 'AIRDROP'].includes(editData.action)
  }

  const getFilteredWalletsForEdit = (): Wallet[] => {
    if (shouldHidePriceForEdit()) {
      if (isFiatOrStablecoin(editData.ticker || '')) {
        return wallets.filter(w => !w.parent_wallet_id)
      }
      return wallets.filter(w => !!w.parent_wallet_id)
    }
    return wallets
  }

  const shouldShowSubwalletWarning = (): boolean => {
    if (!editData.wallet_id || !editData.ticker || !editData.action) return false
    if (isFiatOrStablecoin(editData.ticker)) return false
    const cryptoActions = ['BUY', 'SELL', 'SWAP', 'AIRDROP', 'DEPOSIT', 'WITHDRAWAL']
    if (!cryptoActions.includes(editData.action)) return false
    const currentWallet = wallets.find(w => w.id === editData.wallet_id)
    return currentWallet ? !currentWallet.parent_wallet_id : false
  }

  const transactionNeedsSubwallet = (tx: Transaction): boolean => {
    // Exchange-level funding for non-stable assets is valid without wallet.
    if (['DEPOSIT', 'WITHDRAWAL'].includes(tx.action) && !isFiatOrStablecoin(tx.ticker)) return false
    if (isFiatOrStablecoin(tx.ticker)) return false
    const cryptoActions = ['BUY', 'SELL', 'SWAP', 'AIRDROP']
    if (!cryptoActions.includes(tx.action)) return false
    const txWallet = wallets.find(w => w.id === tx.wallet_id)
    return txWallet ? !txWallet.parent_wallet_id : false
  }

  const getHierarchicalWalletsAll = () => {
    const result: Array<{ id: string; name: string; displayName: string }> = []
    const rootWallets = wallets.filter(w => !w.parent_wallet_id)

    rootWallets.forEach(root => {
      result.push({ id: root.id, name: root.name, displayName: root.name })
      const children = wallets.filter(w => w.parent_wallet_id === root.id)
      children.forEach(child => {
        result.push({ id: child.id, name: child.name, displayName: `  ↳ ${child.name}` })
      })
    })

    return result
  }

  const getQuickFixWalletOptions = (tx: Transaction) => {
    if (tx.wallet_id && transactionNeedsSubwallet(tx)) {
      const root = wallets.find(w => w.id === tx.wallet_id) || null
      const children = root ? wallets.filter(w => w.parent_wallet_id === root.id) : []

      const primary: Array<{ id: string; displayName: string }> = []

      if (root) {
        primary.push({ id: root.id, displayName: `${root.name} (root)` })
      }
      children.forEach(c => primary.push({ id: c.id, displayName: `↳ ${c.name}` }))

      const allHier = getHierarchicalWalletsAll().map(w => ({ id: w.id, displayName: w.displayName }))
      const primaryIds = new Set(primary.map(p => p.id))
      const rest = allHier.filter(w => !primaryIds.has(w.id))

      return [...primary, ...rest]
    }

    return getHierarchicalWalletsAll().map(w => ({ id: w.id, displayName: w.displayName }))
  }

  const openWarningPopover = (tx: Transaction) => {
    setWarningTxId(tx.id)

    if (tx.wallet_id && transactionNeedsSubwallet(tx)) {
      const root = wallets.find(w => w.id === tx.wallet_id) || null
      const children = root ? wallets.filter(w => w.parent_wallet_id === root.id) : []
      if (children.length > 0) {
        setWarningSelectedWalletId(children[0].id)
      } else {
        setWarningSelectedWalletId(tx.wallet_id)
      }
      return
    }

    setWarningSelectedWalletId(tx.wallet_id || '')
  }

  const saveWarningPopover = async () => {
    if (!warningTxId) return
    if (!warningSelectedWalletId) {
      alert('Select a wallet')
      return
    }

    setWarningSaving(true)
    try {
      const res = await fetch(`/api/transactions/${warningTxId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_id: warningSelectedWalletId }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || 'Failed to update wallet')
      }

      setWarningTxId(null)
      setWarningSelectedWalletId('')
      loadTransactions()
    } catch (err: any) {
      alert(`Error: ${err.message}`)
    } finally {
      setWarningSaving(false)
    }
  }

  const getHierarchicalWallets = () => {
    const walletsToUse = getFilteredWalletsForEdit()
    const result: Array<{ id: string; name: string; displayName: string }> = []

    const rootWallets = walletsToUse.filter(w => !w.parent_wallet_id)

    rootWallets.forEach(root => {
      result.push({ id: root.id, name: root.name, displayName: root.name })
      const children = walletsToUse.filter(w => w.parent_wallet_id === root.id)
      children.forEach(child => {
        result.push({ id: child.id, name: child.name, displayName: `  ↳ ${child.name}` })
      })
    })

    return result
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this transaction?')) return
    try {
      await fetch(`/api/transactions/${id}`, { method: 'DELETE' })
      loadTransactions()
    } catch (error) {
      console.error('Failed to delete:', error)
    }
  }

  const handleBulkDelete = async () => {
    if (!confirm(`Delete ${selectedIds.length} transactions?`)) return
    try {
      await Promise.all(selectedIds.map(id => fetch(`/api/transactions/${id}`, { method: 'DELETE' })))
      setSelectedIds([])
      setDuplicateCandidateIds(prev => prev.filter(id => !selectedIds.includes(id)))
      loadTransactions()
    } catch (error) {
      console.error('Failed to delete:', error)
    }
  }

  const handleClearAllTransactions = async () => {
    const guard = prompt('Type DELETE to confirm clearing all transactions')
    if (guard !== 'DELETE') return

    setClearingAll(true)
    try {
      const res = await fetch('/api/transactions', { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Failed to clear transactions')

      setSelectedIds([])
      setDuplicateCandidateIds([])
      await loadTransactions(1)
      alert(`Deleted ${data?.deleted ?? 0} transactions`)
    } catch (error: any) {
      alert(`Error: ${error.message}`)
    } finally {
      setClearingAll(false)
    }
  }

  const startEdit = (tx: Transaction) => {
    setEditingId(tx.id)
    setEditData({
      date: tx.date,
      action: tx.action,
      ticker: tx.ticker,
      quantity: tx.quantity,
      price: tx.price,
      price_currency: tx.price_currency,
      exchange: tx.exchange,
      wallet_id: tx.wallet_id,
      fees: tx.fees,
      fees_currency: tx.fees_currency,
      notes: tx.notes,
    })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditData({})
    setShowNewWalletInEdit(false)
    setNewWalletName('')
    setNewWalletParent('')
  }

  const handleCreateWalletInEdit = async () => {
    if (!newWalletName.trim()) {
      alert('Wallet name is required')
      return
    }

    setCreatingWallet(true)
    try {
      const payload: any = { name: newWalletName.trim() }
      if (newWalletParent) payload.parent_wallet_id = newWalletParent

      const res = await fetch('/api/wallets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || 'Failed to create wallet')
      }

      const newWallet = await res.json()
      await loadWallets()
      setEditData({ ...editData, wallet_id: newWallet.id })
      setShowNewWalletInEdit(false)
      setNewWalletName('')
      setNewWalletParent('')
    } catch (err: any) {
      alert(`Error: ${err.message}`)
    } finally {
      setCreatingWallet(false)
    }
  }

  const handleWalletChangeInEdit = (value: string) => {
    if (value === '__CREATE_NEW__') {
      setShowNewWalletInEdit(true)
    } else {
      setEditData({ ...editData, wallet_id: value })
    }
  }

  const saveEdit = async () => {
    if (!editingId) return
    setSaving(true)
    try {
      const actionUpper = String(editData.action || '').toUpperCase()
      const isZeroCostEdit = ['DEPOSIT', 'WITHDRAWAL', 'AIRDROP'].includes(actionUpper)
      const payload = {
        date: editData.date ? new Date(editData.date).toISOString() : undefined,
        action: editData.action,
        ticker: editData.ticker?.toUpperCase(),
        quantity: editData.quantity,
        price: isZeroCostEdit ? 0 : editData.price,
        price_currency: isZeroCostEdit ? null : editData.price_currency?.toUpperCase(),
        exchange: editData.exchange,
        wallet_id: editData.wallet_id,
        fees: editData.fees,
        fees_currency: editData.fees_currency?.toUpperCase(),
        notes: editData.notes,
      }

      const res = await fetch(`/api/transactions/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || 'Failed to update')
      }

      setEditingId(null)
      setEditData({})
      loadTransactions()
    } catch (error: any) {
      alert(`Error: ${error.message}`)
    } finally {
      setSaving(false)
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))
  }

  const toggleSelectAll = () => {
    const visibleIds = filteredTransactions.map(t => t.id)
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.includes(id))

    if (allVisibleSelected) {
      setSelectedIds(prev => prev.filter(id => !visibleIds.includes(id)))
    } else {
      setSelectedIds(prev => Array.from(new Set([...prev, ...visibleIds])))
    }
  }

  const allVisibleSelected =
    filteredTransactions.length > 0 && filteredTransactions.every(t => selectedIds.includes(t.id))

  const changePage = (nextPage: number) => {
    if (nextPage < 1 || nextPage > pagination.totalPages || nextPage === pagination.page) return
    setSelectedIds([])
    loadTransactions(nextPage)
  }

  const pageButtons = useMemo(() => {
    const total = pagination.totalPages || 1
    return [1, 2, 3].filter((p) => p <= total)
  }, [pagination.page, pagination.totalPages])

  const jumpToPage = () => {
    const parsed = parseInt(pageJumpInput, 10)
    if (!Number.isFinite(parsed)) return
    changePage(parsed)
  }

  const handleExportCsv = async (mode: 'ALL' | 'FILTERED') => {
    setExportingMode(mode)
    try {
      const params = new URLSearchParams()
      if (mode === 'FILTERED') {
        if (search.trim()) params.set('q', search.trim())
        if (tickerFilter.trim()) params.set('ticker', tickerFilter.trim())
        if (exchangeFilter.trim()) params.set('exchange', exchangeFilter.trim())
        if (actionFilter !== 'ALL') params.set('action', actionFilter)
        if (walletFilter !== 'ALL') params.set('wallet', walletFilter)
      }

      const query = params.toString()
      const res = await fetch(`/api/transactions/export${query ? `?${query}` : ''}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || 'Export failed')
      }

      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      const today = new Date().toISOString().slice(0, 10)
      a.href = url
      a.download = `transactions-export-${mode === 'FILTERED' ? 'filtered' : 'all'}-${today}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch (err: any) {
      alert(err?.message || 'Errore export CSV')
    } finally {
      setExportingMode(null)
    }
  }

  const handleFindDuplicates = async () => {
    setFindingDuplicates(true)
    try {
      const res = await fetch('/api/transactions/duplicates')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Errore ricerca duplicati')

      const idsToDelete: string[] = Array.isArray(data?.ids_to_delete) ? data.ids_to_delete : []
      setDuplicateCandidateIds(idsToDelete)
      setSelectedIds(idsToDelete)

      if (idsToDelete.length === 0) {
        alert('Nessun duplicato trovato.')
        return
      }

      alert(
        `Duplicati trovati: ${data?.duplicate_groups ?? 0} gruppi.\n` +
        `Selezionati per eliminazione: ${idsToDelete.length} record.\n` +
        'E stato mantenuto 1 record per ogni gruppo duplicato.'
      )
    } catch (e: any) {
      alert(e?.message || 'Errore ricerca duplicati')
    } finally {
      setFindingDuplicates(false)
    }
  }

  const loadImportHistory = async () => {
    setLoadingImportHistory(true)
    try {
      const res = await fetch('/api/transactions/import-batches')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Errore caricamento storico import')
      setImportHistory(Array.isArray(data?.batches) ? data.batches : [])
    } catch (e: any) {
      alert(e?.message || 'Errore caricamento storico import')
    } finally {
      setLoadingImportHistory(false)
    }
  }

  const handleOpenImportHistory = async () => {
    setShowImportHistory(true)
    await loadImportHistory()
  }

  const handleUndoLastImport = async () => {
    if (!confirm('Annullare l’ultima importazione? Verranno eliminati i record importati in quell’operazione.')) return
    setUndoingLastImport(true)
    try {
      const res = await fetch('/api/transactions/import-batches/undo-last', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Undo ultimo import fallito')
      alert(`Import annullato. Transazioni eliminate: ${data?.deleted_transactions ?? 0}`)
      setSelectedIds([])
      setDuplicateCandidateIds([])
      await loadTransactions(1)
      if (showImportHistory) await loadImportHistory()
    } catch (e: any) {
      alert(e?.message || 'Undo ultimo import fallito')
    } finally {
      setUndoingLastImport(false)
    }
  }

  const handleDeleteImportBatch = async (batchId: string) => {
    if (!confirm('Eliminare questa importazione dallo storico e cancellare tutte le sue transazioni?')) return
    setDeletingImportBatchId(batchId)
    try {
      const res = await fetch(`/api/transactions/import-batches/${batchId}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Cancellazione import fallita')
      alert(`Import eliminato. Transazioni rimosse: ${data?.deleted_transactions ?? 0}`)
      await loadImportHistory()
      setSelectedIds([])
      setDuplicateCandidateIds([])
      await loadTransactions(1)
    } catch (e: any) {
      alert(e?.message || 'Cancellazione import fallita')
    } finally {
      setDeletingImportBatchId(null)
    }
  }

  if (loading && transactions.length === 0) {
    return (
      <div className="flex justify-center items-center h-64">
        <p className="text-gray-500">Loading...</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Transactions</h1>
        <div className="flex gap-3">
          <button
            onClick={handleClearAllTransactions}
            disabled={clearingAll}
            className="px-4 py-2 border border-red-300 text-red-700 rounded-md hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {clearingAll ? 'Clearing...' : 'Svuota Transazioni'}
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
          >
            Import CSV
          </button>
          <button
            onClick={() => handleExportCsv('ALL')}
            disabled={exportingMode !== null}
            className="px-4 py-2 border border-emerald-300 text-emerald-700 rounded-md hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {exportingMode === 'ALL' ? 'Exporting...' : 'Export CSV (Tutto)'}
          </button>
          <button
            onClick={() => handleExportCsv('FILTERED')}
            disabled={exportingMode !== null}
            className="px-4 py-2 border border-teal-300 text-teal-700 rounded-md hover:bg-teal-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {exportingMode === 'FILTERED' ? 'Exporting...' : 'Export CSV (Filtrato)'}
          </button>
          <button
            onClick={handleUndoLastImport}
            disabled={undoingLastImport}
            className="px-4 py-2 border border-orange-300 text-orange-700 rounded-md hover:bg-orange-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {undoingLastImport ? 'Undoing...' : 'Annulla Ultimo Import'}
          </button>
          <button
            onClick={handleOpenImportHistory}
            className="px-4 py-2 border border-indigo-300 text-indigo-700 rounded-md hover:bg-indigo-50"
          >
            Storico Import
          </button>
          <button
            onClick={handleFindDuplicates}
            disabled={findingDuplicates}
            className="px-4 py-2 border border-amber-300 text-amber-700 rounded-md hover:bg-amber-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {findingDuplicates ? 'Scanning...' : 'Trova Duplicati'}
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Add Transaction
          </button>
        </div>
      </div>

      <TransactionsToolbar
        search={search}
        setSearch={setSearch}
        searchSuggestions={searchSuggestions}
        tickerFilter={tickerFilter}
        setTickerFilter={setTickerFilter}
        exchangeFilter={exchangeFilter}
        setExchangeFilter={setExchangeFilter}
        actionFilter={actionFilter}
        setActionFilter={setActionFilter}
        walletFilter={walletFilter}
        setWalletFilter={setWalletFilter}
        walletOptions={['UNASSIGNED', ...walletOptions]}
        onClear={() => {
          setSearch('')
          setTickerFilter('')
          setExchangeFilter('')
          setActionFilter('ALL')
          setWalletFilter('ALL')
        }}
      />

      {selectedIds.length > 0 && (
        <div className="mb-4 flex items-center justify-between rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <span className="font-medium text-blue-900">{selectedIds.length} selected</span>
          <div className="space-x-2">
            <button
              onClick={() => setSelectedIds([])}
              className="rounded-xl border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleBulkDelete}
              className="rounded-xl bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700"
            >
              Delete Selected
            </button>
          </div>
        </div>
      )}

      {duplicateCandidateIds.length > 0 && (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Duplicati segnalati: {duplicateCandidateIds.length}. Sono gia selezionati per eventuale eliminazione.
        </div>
      )}

      {/* ✅ NEW: scroll container + sticky header */}
      <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <div className="max-h-[65vh] overflow-auto rounded-2xl">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="sticky top-0 z-10 bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAll}
                    className="rounded border-gray-300"
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date & Time</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Lev</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ticker</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Wallet</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Quantity</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Price</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Exchange</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fees</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>

            <tbody className="bg-white divide-y divide-gray-200">
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-gray-500">
                    No transactions match the filters.
                  </td>
                </tr>
              ) : (
                filteredTransactions.map(tx => {
                  const isEditing = editingId === tx.id
                  const isDuplicateCandidate = duplicateCandidateIds.includes(tx.id)

                  return (
                    <tr
                      key={tx.id}
                      className={
                        isEditing
                          ? 'bg-blue-50'
                          : isDuplicateCandidate
                          ? 'bg-amber-50 hover:bg-amber-100'
                          : 'hover:bg-gray-50'
                      }
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(tx.id)}
                          onChange={() => toggleSelect(tx.id)}
                          className="rounded border-gray-300"
                          disabled={isEditing}
                        />
                      </td>

                      <td className="px-4 py-3 text-sm">
                        {isEditing ? (
                          <input
                            type="datetime-local"
                            value={editData.date ? new Date(editData.date).toISOString().slice(0, 16) : ''}
                            onChange={(e) => setEditData({ ...editData, date: e.target.value })}
                            className="w-full px-2 py-1 border rounded text-xs"
                          />
                        ) : (
                          <span className="text-xs">{formatDateTime(tx.date)}</span>
                        )}
                      </td>

                      <td className="px-4 py-3 text-sm">
                        {isEditing ? (
                          <div className="flex items-center gap-2">
                            <select
                              value={editData.direction || ''}
                              onChange={(e) => setEditData({ ...editData, direction: e.target.value || null })}
                              className="px-2 py-1 border rounded text-xs"
                            >
                              <option value="">—</option>
                              <option value="LONG">LONG</option>
                              <option value="SHORT">SHORT</option>
                            </select>
                            <input
                              type="number"
                              step="0.1"
                              min="1"
                              value={editData.leverage ?? ''}
                              onChange={(e) => setEditData({ ...editData, leverage: e.target.value ? parseFloat(e.target.value) : null })}
                              className="w-20 px-2 py-1 border rounded text-xs"
                              placeholder="x"
                            />
                          </div>
                        ) : tx.leverage ? (
                          <span className="text-xs font-medium text-indigo-700">
                            {(tx.direction || 'LONG').toUpperCase()} x{Number(tx.leverage).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                          </span>
                        ) : (
                          <span className="text-xs text-neutral-400">—</span>
                        )}
                      </td>

                      <td className="px-4 py-3 text-sm">
                        {isEditing ? (
                          <select
                            value={editData.action}
                            onChange={(e) => setEditData({ ...editData, action: e.target.value })}
                            className="w-full px-2 py-1 border rounded text-xs"
                          >
                            <option value="BUY">BUY</option>
                            <option value="SELL">SELL</option>
                            <option value="DEPOSIT">DEPOSIT</option>
                            <option value="WITHDRAWAL">WITHDRAWAL</option>
                            <option value="SWAP">SWAP</option>
                            <option value="AIRDROP">AIRDROP</option>
                          </select>
                        ) : (
                          <span
                            className={`px-2 py-1 rounded text-xs font-medium ${
                              tx.action === 'BUY'
                                ? 'bg-green-100 text-green-800'
                                : tx.action === 'SELL'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-blue-100 text-blue-800'
                            }`}
                          >
                            {tx.action}
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3 text-sm font-medium">
                        {isEditing ? (
                          <>
                            <input
                              type="text"
                              list="edit-ticker-suggestions"
                              value={editData.ticker || ''}
                              onChange={(e) => setEditData({ ...editData, ticker: e.target.value.toUpperCase() })}
                              className="w-full px-2 py-1 border rounded text-xs"
                              style={{ WebkitAppearance: 'none', MozAppearance: 'textfield', minWidth: '100px' }}
                            />
                            <datalist id="edit-ticker-suggestions">
                              {suggestions.tickers.map(t => (
                                <option key={t} value={t} />
                              ))}
                            </datalist>
                          </>
                        ) : (
                          tx.ticker
                        )}
                      </td>

                      <td className="px-4 py-3 text-sm">
                        {isEditing ? (
                          <div className="space-y-2">
                            <select
                              value={editData.wallet_id || ''}
                              onChange={(e) => {
                                const v = e.target.value
                                if (v === '__CREATE_NEW__') {
                                  setShowNewWalletInEdit(true)
                                } else {
                                  setEditData({ ...editData, wallet_id: v })
                                }
                              }}
                              className="w-full px-2 py-1 border rounded text-xs"
                              style={{ minWidth: '150px' }}
                              disabled={showNewWalletInEdit}
                            >
                              {getHierarchicalWallets().map(w => (
                                <option key={w.id} value={w.id}>
                                  {w.displayName}
                                </option>
                              ))}
                              <option value="__CREATE_NEW__" className="font-semibold text-blue-600">
                                + Create New Wallet
                              </option>
                            </select>

                            {shouldHidePriceForEdit() && (
                              <p className="text-xs text-blue-600 mt-1">Only root wallets for FIAT/Stablecoin</p>
                            )}

                            {shouldShowSubwalletWarning() && (
                              <p className="text-xs text-red-600 mt-1 font-semibold">⚠️ Crypto should be in subwallet!</p>
                            )}

                            {showNewWalletInEdit && (
                              <div className="bg-blue-50 border border-blue-200 rounded p-2 space-y-2">
                                <input
                                  type="text"
                                  value={newWalletName}
                                  onChange={(e) => setNewWalletName(e.target.value)}
                                  placeholder="Wallet name"
                                  className="w-full px-2 py-1 border rounded text-xs"
                                  disabled={creatingWallet}
                                />
                                <select
                                  value={newWalletParent}
                                  onChange={(e) => setNewWalletParent(e.target.value)}
                                  className="w-full px-2 py-1 border rounded text-xs"
                                  disabled={creatingWallet}
                                >
                                  <option value="">None (Root wallet)</option>
                                  {wallets
                                    .filter(w => !w.parent_wallet_id)
                                    .map(w => (
                                      <option key={w.id} value={w.id}>
                                        {w.name}
                                      </option>
                                    ))}
                                </select>
                                <div className="flex gap-1">
                                  <button
                                    onClick={async () => {
                                      if (!newWalletName.trim()) {
                                        alert('Wallet name is required')
                                        return
                                      }

                                      setCreatingWallet(true)
                                      try {
                                        const payload: any = { name: newWalletName.trim() }
                                        if (newWalletParent) payload.parent_wallet_id = newWalletParent

                                        const res = await fetch('/api/wallets', {
                                          method: 'POST',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify(payload),
                                        })

                                        if (!res.ok) {
                                          const data = await res.json().catch(() => ({}))
                                          throw new Error(data?.error || 'Failed to create wallet')
                                        }

                                        const newWallet = await res.json()
                                        await loadWallets()
                                        setEditData({ ...editData, wallet_id: newWallet.id })
                                        setShowNewWalletInEdit(false)
                                        setNewWalletName('')
                                        setNewWalletParent('')
                                      } catch (err: any) {
                                        alert(`Error: ${err.message}`)
                                      } finally {
                                        setCreatingWallet(false)
                                      }
                                    }}
                                    disabled={creatingWallet || !newWalletName.trim()}
                                    className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:opacity-50"
                                  >
                                    {creatingWallet ? '...' : 'Create'}
                                  </button>
                                  <button
                                    onClick={() => {
                                      setShowNewWalletInEdit(false)
                                      setNewWalletName('')
                                      setNewWalletParent('')
                                    }}
                                    disabled={creatingWallet}
                                    className="px-2 py-1 border rounded text-xs hover:bg-gray-50 disabled:opacity-50"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="relative inline-flex items-center gap-1" ref={warningTxId === tx.id ? warningPopoverRef : undefined}>
                            {tx.wallet_name ? (
                              <span className="text-gray-900">{tx.wallet_name}</span>
                            ) : (['DEPOSIT', 'WITHDRAWAL'].includes(tx.action) && !isFiatOrStablecoin(tx.ticker)) ? (
                              <span className="text-blue-600 font-semibold">EXCHANGE-ONLY</span>
                            ) : (
                              <span className="text-red-600 font-semibold">UNASSIGNED</span>
                            )}

                            {(transactionNeedsSubwallet(tx) || !tx.wallet_id) && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openWarningPopover(tx)
                                }}
                                className="ml-1 text-yellow-600 hover:text-yellow-700 font-bold"
                                title={
                                  transactionNeedsSubwallet(tx)
                                    ? 'Crypto DEPOSIT/WITHDRAWAL deve stare in subwallet (click per correggere)'
                                    : 'Wallet not assigned (click to assign)'
                                }
                              >
                                ⚠️
                              </button>
                            )}

                            {warningTxId === tx.id && (
                              <div className="absolute left-0 top-full mt-2 z-20 w-72 rounded-md border border-gray-200 bg-white shadow-lg p-3">
                                <div className="text-xs font-semibold text-gray-800 mb-2">
                                  {transactionNeedsSubwallet(tx) ? 'Move transaction to a subwallet' : 'Assign wallet'}
                                </div>

                                <div className="space-y-2">
                                  <select
                                    value={warningSelectedWalletId}
                                    onChange={(e) => setWarningSelectedWalletId(e.target.value)}
                                    className="w-full px-2 py-1 border rounded text-xs"
                                  >
                                    <option value="">Select…</option>
                                    {getQuickFixWalletOptions(tx).map((w) => (
                                      <option key={w.id} value={w.id}>
                                        {w.displayName}
                                      </option>
                                    ))}
                                  </select>

                                  <div className="flex items-center justify-end gap-2">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setWarningTxId(null)
                                        setWarningSelectedWalletId('')
                                      }}
                                      className="px-2 py-1 text-xs border rounded hover:bg-gray-50"
                                      disabled={warningSaving}
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      onClick={saveWarningPopover}
                                      className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                                      disabled={warningSaving || !warningSelectedWalletId}
                                    >
                                      {warningSaving ? '...' : 'Save'}
                                    </button>
                                  </div>

                                  {transactionNeedsSubwallet(tx) && (
                                    <p className="text-[11px] text-gray-500">
                                      Nota: metti le operazioni spot/derivati in un sub-wallet operativo.
                                    </p>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Quantity */}
                      <td className="px-4 py-3 text-sm">
                        {isEditing ? (
                          <input
                            type="number"
                            step="0.00000001"
                            value={editData.quantity ?? ''}
                            onChange={(e) => setEditData({ ...editData, quantity: parseFloat(e.target.value) })}
                            className="w-full px-2 py-1 border rounded text-xs"
                            style={{ minWidth: '100px' }}
                          />
                        ) : (
                          tx.quantity.toFixed(8)
                        )}
                      </td>

                      {/* Price + Price Currency */}
                      <td className="px-4 py-3 text-sm">
                        {isEditing ? (
                          shouldHidePriceForEdit() ? (
                            <span className="text-xs text-blue-500 italic">n/a</span>
                          ) : (
                            <div className="flex gap-1 items-center">
                              <input
                                type="number"
                                step="0.00000001"
                                value={editData.price ?? ''}
                                onChange={(e) => setEditData({ ...editData, price: parseFloat(e.target.value) })}
                                className="px-2 py-1 border rounded text-xs"
                                style={{ minWidth: '80px' }}
                              />
                              <input
                                type="text"
                                list="edit-price-currency-suggestions"
                                value={editData.price_currency || ''}
                                onChange={(e) => setEditData({ ...editData, price_currency: e.target.value.toUpperCase() })}
                                className="px-2 py-1 border rounded text-xs"
                                style={{ minWidth: '60px', WebkitAppearance: 'none' }}
                                placeholder="USDT"
                              />
                              <datalist id="edit-price-currency-suggestions">
                                {suggestions.currencies.map(c => <option key={c} value={c} />)}
                              </datalist>
                            </div>
                          )
                        ) : (['DEPOSIT', 'WITHDRAWAL'].includes(tx.action) ? '—' : formatCurrency(tx.price, tx.price_currency))}
                      </td>

                      {/* Exchange */}
                      <td className="px-4 py-3 text-sm">
                        {isEditing ? (
                          <>
                            <input
                              type="text"
                              list="edit-exchange-suggestions"
                              value={editData.exchange || ''}
                              onChange={(e) => setEditData({ ...editData, exchange: e.target.value })}
                              className="w-full px-2 py-1 border rounded text-xs"
                              style={{ minWidth: '100px', WebkitAppearance: 'none' }}
                            />
                            <datalist id="edit-exchange-suggestions">
                              {suggestions.exchanges.map(ex => <option key={ex} value={ex} />)}
                            </datalist>
                          </>
                        ) : (
                          tx.exchange
                        )}
                      </td>

                      {/* Fees + Fees Currency */}
                      <td className="px-4 py-3 text-sm">
                        {isEditing ? (
                          <div className="flex gap-1 items-center">
                            <input
                              type="number"
                              step="0.00000001"
                              value={editData.fees ?? ''}
                              onChange={(e) => setEditData({ ...editData, fees: parseFloat(e.target.value) })}
                              className="px-2 py-1 border rounded text-xs"
                              style={{ minWidth: '70px' }}
                              placeholder="0"
                            />
                            <input
                              type="text"
                              list="edit-fees-currency-suggestions"
                              value={editData.fees_currency || ''}
                              onChange={(e) => setEditData({ ...editData, fees_currency: e.target.value.toUpperCase() })}
                              className="px-2 py-1 border rounded text-xs"
                              style={{ minWidth: '60px', WebkitAppearance: 'none' }}
                              placeholder="USDT"
                            />
                            <datalist id="edit-fees-currency-suggestions">
                              {suggestions.currencies.map(c => <option key={c} value={c} />)}
                            </datalist>
                          </div>
                        ) : (
                          tx.fees > 0 ? formatCurrency(tx.fees, tx.fees_currency) : '-'
                        )}
                      </td>

                      <td className="px-4 py-3 text-sm">
                        {isEditing ? (
                          <div className="flex gap-1">
                            <button
                              onClick={saveEdit}
                              disabled={saving}
                              className="px-2 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700 disabled:opacity-50"
                            >
                              {saving ? '...' : 'Save'}
                            </button>
                            <button
                              onClick={cancelEdit}
                              disabled={saving}
                              className="px-2 py-1 border rounded text-xs hover:bg-gray-50 disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <button onClick={() => startEdit(tx)} className="text-blue-600 hover:text-blue-800 text-xs">
                              Edit
                            </button>
                            <button onClick={() => handleDelete(tx.id)} className="text-red-600 hover:text-red-800 text-xs">
                              Delete
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="text-gray-600">
          Page {pagination.page} of {pagination.totalPages} • Total transactions: {pagination.total}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => changePage(pagination.page - 1)}
            disabled={pagination.page <= 1}
            className="rounded border px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-gray-50"
          >
            Prev
          </button>
          <div className="flex items-center gap-1">
            {pageButtons.map((p) => (
              <button
                key={p}
                onClick={() => changePage(p)}
                className={`rounded border px-3 py-1.5 ${
                  p === pagination.page
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'hover:bg-gray-50'
                }`}
              >
                {p}
              </button>
            ))}
            <input
              value={pageJumpInput}
              onChange={(e) => setPageJumpInput(e.target.value.replace(/[^\d]/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') jumpToPage()
              }}
              className="w-16 rounded border px-2 py-1.5 text-center"
              placeholder="page"
            />
            <button
              onClick={jumpToPage}
              className="rounded border px-2 py-1.5 hover:bg-gray-50"
            >
              Go
            </button>
            {pagination.totalPages > 3 && (
              <>
                <span className="px-1 text-gray-400">...</span>
                <button
                  onClick={() => changePage(pagination.totalPages)}
                  className={`rounded border px-3 py-1.5 ${
                    pagination.totalPages === pagination.page
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  {pagination.totalPages}
                </button>
              </>
            )}
          </div>
          <button
            onClick={() => changePage(pagination.page + 1)}
            disabled={pagination.page >= pagination.totalPages}
            className="rounded border px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-50 hover:bg-gray-50"
          >
            Next
          </button>
        </div>
      </div>

      {showForm && <TransactionForm onClose={() => setShowForm(false)} onSuccess={loadTransactions} />}
      {showImport && <CSVImport onClose={() => setShowImport(false)} onSuccess={loadTransactions} />}

      {showImportHistory && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
          <div className="w-full max-w-4xl rounded-2xl bg-white shadow-xl border border-gray-200">
            <div className="p-5 border-b flex items-center justify-between">
              <div>
                <div className="text-lg font-semibold">Storico Importazioni</div>
                <div className="text-xs text-gray-500">Seleziona una importazione da annullare</div>
              </div>
              <button
                onClick={() => setShowImportHistory(false)}
                className="px-3 py-2 text-sm rounded border hover:bg-gray-50"
              >
                Close
              </button>
            </div>

            <div className="p-5 max-h-[60vh] overflow-auto">
              {loadingImportHistory ? (
                <div className="text-sm text-gray-500">Caricamento...</div>
              ) : importHistory.length === 0 ? (
                <div className="text-sm text-gray-500">Nessuna importazione trovata.</div>
              ) : (
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left px-3 py-2">Data</th>
                      <th className="text-left px-3 py-2">File</th>
                      <th className="text-right px-3 py-2">Totale</th>
                      <th className="text-right px-3 py-2">Importate</th>
                      <th className="text-right px-3 py-2">Scartate</th>
                      <th className="text-left px-3 py-2">Status</th>
                      <th className="text-right px-3 py-2">Azioni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importHistory.map((b) => (
                      <tr key={b.id} className="border-b">
                        <td className="px-3 py-2">{new Date(b.created_at).toLocaleString('it-IT')}</td>
                        <td className="px-3 py-2">{b.filename || '-'}</td>
                        <td className="px-3 py-2 text-right">{b.total_rows ?? '-'}</td>
                        <td className="px-3 py-2 text-right">{b.imported_count ?? 0}</td>
                        <td className="px-3 py-2 text-right">{b.skipped_count ?? 0}</td>
                        <td className="px-3 py-2">
                          <span className="text-xs rounded bg-gray-100 px-2 py-1">{b.status}</span>
                          {b.error_message ? <div className="text-xs text-red-600 mt-1">{b.error_message}</div> : null}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={() => handleDeleteImportBatch(b.id)}
                            disabled={deletingImportBatchId === b.id}
                            className="px-3 py-1 text-xs rounded border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
                          >
                            {deletingImportBatchId === b.id ? 'Deleting...' : 'Cancella Import'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
