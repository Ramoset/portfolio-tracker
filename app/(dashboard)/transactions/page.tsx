'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { formatCurrency } from '@/lib/utils'
import TransactionForm from './TransactionForm'
import CSVImport from './CSVImport'

interface Transaction {
  id: string
  date: string
  action: string
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

const FIAT_STABLECOINS = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'FDUSD']

function formatDateTime(isoString: string): string {
  const date = new Date(isoString)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editData, setEditData] = useState<Partial<Transaction>>({})
  const [saving, setSaving] = useState(false)

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
    loadTransactions()
    loadWallets()
  }, [])

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

  const loadTransactions = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/transactions?page=1&limit=100')
      const data = await res.json()
      setTransactions(data.transactions || [])
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

  const isFiatOrStablecoin = (ticker: string): boolean => {
    return FIAT_STABLECOINS.includes(ticker.toUpperCase())
  }

  const shouldHidePriceForEdit = (): boolean => {
    if (!editData.action || !editData.ticker) return false
    const isDepositWithdrawal = ['DEPOSIT', 'WITHDRAWAL'].includes(editData.action)
    return isDepositWithdrawal && isFiatOrStablecoin(editData.ticker)
  }

  const getFilteredWalletsForEdit = (): Wallet[] => {
    if (shouldHidePriceForEdit()) {
      return wallets.filter(w => !w.parent_wallet_id) // Only root wallets
    }
    return wallets
  }

  const shouldShowSubwalletWarning = (): boolean => {
    if (!editData.wallet_id || !editData.ticker || !editData.action) return false
    if (isFiatOrStablecoin(editData.ticker)) return false
    const cryptoActions = ['BUY', 'SELL', 'SWAP', 'AIRDROP']
    if (!cryptoActions.includes(editData.action)) return false
    const currentWallet = wallets.find(w => w.id === editData.wallet_id)
    return currentWallet ? !currentWallet.parent_wallet_id : false
  }

  const transactionNeedsSubwallet = (tx: Transaction): boolean => {
    if (isFiatOrStablecoin(tx.ticker)) return false
    const cryptoActions = ['BUY', 'SELL', 'SWAP', 'AIRDROP']
    if (!cryptoActions.includes(tx.action)) return false
    const txWallet = wallets.find(w => w.id === tx.wallet_id)
    return txWallet ? !txWallet.parent_wallet_id : false
  }

  // Full hierarchical list (root + children)
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

  // Wallet options for the quick-fix popover
  // ✅ Ora include ANCHE il root (e volendo pure qualunque altro wallet)
  const getQuickFixWalletOptions = (tx: Transaction) => {
    // Caso: crypto in root -> mettiamo prima (root + suoi figli), poi tutto il resto
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

    // Caso: UNASSIGNED -> lista completa gerarchica
    return getHierarchicalWalletsAll().map(w => ({ id: w.id, displayName: w.displayName }))
  }

  const openWarningPopover = (tx: Transaction) => {
    setWarningTxId(tx.id)

    // Preselect: se è crypto in root, proponi la prima subwallet SE ESISTE,
    // altrimenti rimani sul root. In ogni caso ora puoi scegliere anche root.
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

    // UNASSIGNED: nessuna preselezione "forzata"
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
      loadTransactions()
    } catch (error) {
      console.error('Failed to delete:', error)
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
      const payload = {
        date: editData.date ? new Date(editData.date).toISOString() : undefined,
        action: editData.action,
        ticker: editData.ticker?.toUpperCase(),
        quantity: editData.quantity,
        price: editData.price,
        price_currency: editData.price_currency?.toUpperCase(),
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
    setSelectedIds(prev => (prev.length === transactions.length ? [] : transactions.map(t => t.id)))
  }

  if (loading) {
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
            onClick={() => setShowImport(true)}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
          >
            Import CSV
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Add Transaction
          </button>
        </div>
      </div>

      {selectedIds.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4 flex justify-between items-center">
          <span className="font-medium text-blue-900">{selectedIds.length} selected</span>
          <div className="space-x-2">
            <button
              onClick={() => setSelectedIds([])}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleBulkDelete}
              className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-md hover:bg-red-700"
            >
              Delete Selected
            </button>
          </div>
        </div>
      )}

      <div className="bg-white shadow rounded-lg overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left">
                <input
                  type="checkbox"
                  checked={selectedIds.length === transactions.length && transactions.length > 0}
                  onChange={toggleSelectAll}
                  className="rounded border-gray-300"
                />
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date & Time</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
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
            {transactions.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-gray-500">
                  No transactions yet. Add your first transaction or import CSV!
                </td>
              </tr>
            ) : (
              transactions.map(tx => {
                const isEditing = editingId === tx.id

                return (
                  <tr key={tx.id} className={isEditing ? 'bg-blue-50' : 'hover:bg-gray-50'}>
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

                    {/* Wallet */}
                    <td className="px-4 py-3 text-sm">
                      {isEditing ? (
                        <div className="space-y-2">
                          <select
                            value={editData.wallet_id || ''}
                            onChange={(e) => handleWalletChangeInEdit(e.target.value)}
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
                                  onClick={handleCreateWalletInEdit}
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
                        <div
                          className="relative inline-flex items-center gap-1"
                          ref={warningTxId === tx.id ? warningPopoverRef : undefined}
                        >
                          {tx.wallet_name ? (
                            <span className="text-gray-900">{tx.wallet_name}</span>
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
                                  ? 'Crypto should be in a subwallet (click to fix)'
                                  : 'Wallet not assigned (click to assign)'
                              }
                            >
                              ⚠️
                            </button>
                          )}

                          {warningTxId === tx.id && (
                            <div className="absolute left-0 top-full mt-2 z-20 w-72 rounded-md border border-gray-200 bg-white shadow-lg p-3">
                              <div className="text-xs font-semibold text-gray-800 mb-2">
                                {transactionNeedsSubwallet(tx) ? 'Move transaction to a subwallet (or keep root)' : 'Assign wallet'}
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
                                    Nota: di solito è meglio mettere le crypto in subwallet, ma puoi anche lasciarle nel root.
                                  </p>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3 text-sm">{tx.quantity.toFixed(8)}</td>
                    <td className="px-4 py-3 text-sm">{formatCurrency(tx.price, tx.price_currency)}</td>
                    <td className="px-4 py-3 text-sm">{tx.exchange}</td>
                    <td className="px-4 py-3 text-sm">{tx.fees > 0 ? formatCurrency(tx.fees, tx.fees_currency) : '-'}</td>

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

      {showForm && <TransactionForm onClose={() => setShowForm(false)} onSuccess={loadTransactions} />}
      {showImport && <CSVImport onClose={() => setShowImport(false)} onSuccess={loadTransactions} />}
    </div>
  )
}
