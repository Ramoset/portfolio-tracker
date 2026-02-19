'use client'

import { useState, useEffect } from 'react'
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
}

// Format date with time
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

  useEffect(() => {
    loadTransactions()
    loadWallets()
  }, [])

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
      await Promise.all(
        selectedIds.map(id => fetch(`/api/transactions/${id}`, { method: 'DELETE' }))
      )
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
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const toggleSelectAll = () => {
    setSelectedIds(prev => 
      prev.length === transactions.length ? [] : transactions.map(t => t.id)
    )
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

                    {/* Date */}
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

                    {/* Action */}
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
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          tx.action === 'BUY' ? 'bg-green-100 text-green-800' :
                          tx.action === 'SELL' ? 'bg-red-100 text-red-800' :
                          'bg-blue-100 text-blue-800'
                        }`}>
                          {tx.action}
                        </span>
                      )}
                    </td>

                    {/* Ticker */}
                    <td className="px-4 py-3 text-sm font-medium">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editData.ticker || ''}
                          onChange={(e) => setEditData({ ...editData, ticker: e.target.value.toUpperCase() })}
                          className="w-full px-2 py-1 border rounded text-xs"
                        />
                      ) : (
                        tx.ticker
                      )}
                    </td>

                    {/* Wallet */}
                    <td className="px-4 py-3 text-sm">
                      {isEditing ? (
                        <select
                          value={editData.wallet_id || ''}
                          onChange={(e) => setEditData({ ...editData, wallet_id: e.target.value })}
                          className="w-full px-2 py-1 border rounded text-xs"
                        >
                          {wallets.map(w => (
                            <option key={w.id} value={w.id}>{w.name}</option>
                          ))}
                        </select>
                      ) : (
                        tx.wallet_name ? (
                          <span className="text-gray-900">{tx.wallet_name}</span>
                        ) : (
                          <span className="text-red-600 font-semibold">UNASSIGNED</span>
                        )
                      )}
                    </td>

                    {/* Quantity */}
                    <td className="px-4 py-3 text-sm">
                      {isEditing ? (
                        <input
                          type="number"
                          step="0.00000001"
                          value={editData.quantity || ''}
                          onChange={(e) => setEditData({ ...editData, quantity: parseFloat(e.target.value) })}
                          className="w-24 px-2 py-1 border rounded text-xs"
                        />
                      ) : (
                        tx.quantity.toFixed(8)
                      )}
                    </td>

                    {/* Price */}
                    <td className="px-4 py-3 text-sm">
                      {isEditing ? (
                        <div className="flex gap-1">
                          <input
                            type="number"
                            step="0.00000001"
                            value={editData.price || ''}
                            onChange={(e) => setEditData({ ...editData, price: parseFloat(e.target.value) })}
                            className="w-20 px-2 py-1 border rounded text-xs"
                          />
                          <input
                            type="text"
                            value={editData.price_currency || ''}
                            onChange={(e) => setEditData({ ...editData, price_currency: e.target.value.toUpperCase() })}
                            className="w-16 px-2 py-1 border rounded text-xs"
                          />
                        </div>
                      ) : (
                        formatCurrency(tx.price, tx.price_currency)
                      )}
                    </td>

                    {/* Exchange */}
                    <td className="px-4 py-3 text-sm">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editData.exchange || ''}
                          onChange={(e) => setEditData({ ...editData, exchange: e.target.value })}
                          className="w-full px-2 py-1 border rounded text-xs"
                        />
                      ) : (
                        tx.exchange
                      )}
                    </td>

                    {/* Fees */}
                    <td className="px-4 py-3 text-sm">
                      {isEditing ? (
                        <div className="flex gap-1">
                          <input
                            type="number"
                            step="0.00000001"
                            value={editData.fees || ''}
                            onChange={(e) => setEditData({ ...editData, fees: parseFloat(e.target.value) })}
                            className="w-16 px-2 py-1 border rounded text-xs"
                          />
                          <input
                            type="text"
                            value={editData.fees_currency || ''}
                            onChange={(e) => setEditData({ ...editData, fees_currency: e.target.value.toUpperCase() })}
                            className="w-16 px-2 py-1 border rounded text-xs"
                          />
                        </div>
                      ) : (
                        tx.fees > 0 ? formatCurrency(tx.fees, tx.fees_currency) : '-'
                      )}
                    </td>

                    {/* Actions */}
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
                          <button
                            onClick={() => startEdit(tx)}
                            className="text-blue-600 hover:text-blue-800 text-xs"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(tx.id)}
                            className="text-red-600 hover:text-red-800 text-xs"
                          >
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

      {showForm && (
        <TransactionForm
          onClose={() => setShowForm(false)}
          onSuccess={loadTransactions}
        />
      )}

      {showImport && (
        <CSVImport
          onClose={() => setShowImport(false)}
          onSuccess={loadTransactions}
        />
      )}
    </div>
  )
}
