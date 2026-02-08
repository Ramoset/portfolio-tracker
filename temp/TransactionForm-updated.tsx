'use client'

import { useEffect, useMemo, useState } from 'react'

const TRANSACTION_ACTIONS = [
  { value: 'BUY', label: 'Buy' },
  { value: 'SELL', label: 'Sell' },
  { value: 'DEPOSIT', label: 'Deposit' },
  { value: 'WITHDRAWAL', label: 'Withdrawal' },
  { value: 'SWAP', label: 'Swap (legacy)' },
  { value: 'AIRDROP', label: 'Airdrop' },
]

const CURRENCY_OPTIONS = ['USD', 'EUR', 'USDT', 'USDC', 'BTC', 'ETH', 'BNB']

type Wallet = {
  id: string
  name: string
  level: number
  parent_wallet_id: string | null
}

interface TransactionFormProps {
  onClose: () => void
  onSuccess: () => void
}

export default function TransactionForm({ onClose, onSuccess }: TransactionFormProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [wallets, setWallets] = useState<Wallet[]>([])
  const [walletsLoading, setWalletsLoading] = useState(true)

  // New wallet creation state
  const [showNewWalletForm, setShowNewWalletForm] = useState(false)
  const [newWalletName, setNewWalletName] = useState('')
  const [newWalletParent, setNewWalletParent] = useState<string>('')
  const [creatingWallet, setCreatingWallet] = useState(false)

  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    action: 'BUY',
    ticker: '',
    type: 'CRYPTO',
    quantity: '',
    price: '',
    price_currency: 'USDT',
    exchange: '',
    wallet_id: '',
    from_ticker: '',
    to_ticker: '',
    fees: '0',
    fees_currency: 'USDT',
    direction: '',
    leverage: '',
    notes: '',
  })

  useEffect(() => {
    loadWallets()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadWallets = async () => {
    try {
      setWalletsLoading(true)
      const res = await fetch('/api/wallets')
      if (!res.ok) throw new Error('Failed to load wallets')
      const data = await res.json()
      const ws: Wallet[] = data.wallets || []
      setWallets(ws)
      if (!formData.wallet_id && ws?.[0]?.id) {
        setFormData((p) => ({ ...p, wallet_id: ws[0].id }))
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setWalletsLoading(false)
    }
  }

  const walletOptions = useMemo(() => {
    return wallets.map((w) => ({
      id: w.id,
      label: `${'  '.repeat(Math.max(0, w.level - 1))}${w.level > 0 ? '↳ ' : ''}${w.name}`,
      level: w.level,
    }))
  }, [wallets])

  const handleWalletChange = (value: string) => {
    if (value === '__CREATE_NEW__') {
      setShowNewWalletForm(true)
    } else {
      setFormData({ ...formData, wallet_id: value })
    }
  }

  const handleCreateWallet = async () => {
    if (!newWalletName.trim()) {
      setError('Wallet name is required')
      return
    }

    setCreatingWallet(true)
    setError(null)

    try {
      const payload: any = {
        name: newWalletName.trim(),
      }

      if (newWalletParent) {
        payload.parent_wallet_id = newWalletParent
      }

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

      // Reload wallets and select the new one
      await loadWallets()
      setFormData({ ...formData, wallet_id: newWallet.id })
      setShowNewWalletForm(false)
      setNewWalletName('')
      setNewWalletParent('')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setCreatingWallet(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      if (!formData.wallet_id) throw new Error('Wallet is required')
      if (!formData.ticker) throw new Error('Ticker is required')
      if (!formData.quantity || parseFloat(formData.quantity) <= 0) throw new Error('Quantity must be > 0')
      if (!formData.price || parseFloat(formData.price) < 0) throw new Error('Price must be >= 0')
      if (!formData.exchange) throw new Error('Exchange is required')

      if (formData.action === 'SWAP') {
        if (!formData.from_ticker) throw new Error('From ticker required for SWAP')
        if (!formData.to_ticker) throw new Error('To ticker required for SWAP')
      }

      const payload = {
        date: new Date(formData.date).toISOString(),
        action: formData.action,
        ticker: formData.ticker.toUpperCase(),
        type: formData.type,
        quantity: parseFloat(formData.quantity),
        price: parseFloat(formData.price),
        price_currency: formData.price_currency.toUpperCase(),
        exchange: formData.exchange,
        wallet_id: formData.wallet_id,
        from_ticker: formData.action === 'SWAP' ? formData.from_ticker.toUpperCase() : null,
        to_ticker: formData.action === 'SWAP' ? formData.to_ticker.toUpperCase() : null,
        fees: parseFloat(formData.fees || '0'),
        fees_currency: (formData.fees_currency || formData.price_currency).toUpperCase(),
        direction: formData.direction || null,
        leverage: formData.leverage ? parseFloat(formData.leverage) : null,
        notes: formData.notes || null,
      }

      const res = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || 'Failed to create transaction')
      }

      onSuccess()
      onClose()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold">Add Transaction</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">
            ✕
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
            <p className="text-red-800 text-sm">{error}</p>
          </div>
        )}

        {/* New Wallet Form Modal */}
        {showNewWalletForm && (
          <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="font-semibold mb-3 text-blue-900">Create New Wallet</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Wallet Name *</label>
                <input
                  type="text"
                  value={newWalletName}
                  onChange={(e) => setNewWalletName(e.target.value)}
                  placeholder="e.g. Kraken Spot"
                  className="w-full px-3 py-2 border rounded-md"
                  disabled={creatingWallet}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Parent Wallet (optional)</label>
                <select
                  value={newWalletParent}
                  onChange={(e) => setNewWalletParent(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                  disabled={creatingWallet}
                >
                  <option value="">None (Root wallet)</option>
                  {walletOptions
                    .filter((w) => w.level === 0)
                    .map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.label}
                      </option>
                    ))}
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCreateWallet}
                  disabled={creatingWallet || !newWalletName.trim()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {creatingWallet ? 'Creating...' : 'Create Wallet'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowNewWalletForm(false)
                    setNewWalletName('')
                    setNewWalletParent('')
                  }}
                  disabled={creatingWallet}
                  className="px-4 py-2 border rounded-md hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Date *</label>
              <input
                type="date"
                required
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                className="w-full px-3 py-2 border rounded-md"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Action *</label>
              <select
                required
                value={formData.action}
                onChange={(e) => setFormData({ ...formData, action: e.target.value })}
                className="w-full px-3 py-2 border rounded-md"
              >
                {TRANSACTION_ACTIONS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Wallet *</label>
              <select
                required
                value={formData.wallet_id}
                onChange={(e) => handleWalletChange(e.target.value)}
                disabled={walletsLoading}
                className="w-full px-3 py-2 border rounded-md"
              >
                <option value="">Select wallet...</option>
                {walletOptions.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label}
                  </option>
                ))}
                <option value="__CREATE_NEW__" className="font-semibold text-blue-600">
                  + Create New Wallet
                </option>
              </select>
              {walletsLoading && <p className="text-xs text-gray-500 mt-1">Loading wallets...</p>}
            </div>
          </div>

          {formData.action === 'SWAP' && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
              <h3 className="text-sm font-medium mb-2">SWAP Details (legacy)</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">From *</label>
                  <input
                    type="text"
                    required
                    placeholder="ETH"
                    value={formData.from_ticker}
                    onChange={(e) => setFormData({ ...formData, from_ticker: e.target.value.toUpperCase() })}
                    className="w-full px-3 py-2 border rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">To *</label>
                  <input
                    type="text"
                    required
                    placeholder="USDT"
                    value={formData.to_ticker}
                    onChange={(e) => setFormData({ ...formData, to_ticker: e.target.value.toUpperCase() })}
                    className="w-full px-3 py-2 border rounded-md"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Ticker *</label>
              <input
                type="text"
                required
                placeholder="BTC"
                value={formData.ticker}
                onChange={(e) => setFormData({ ...formData, ticker: e.target.value.toUpperCase() })}
                className="w-full px-3 py-2 border rounded-md"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Quantity *</label>
              <input
                type="number"
                step="0.00000001"
                required
                placeholder="0.5"
                value={formData.quantity}
                onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                className="w-full px-3 py-2 border rounded-md"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Price *</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  step="0.00000001"
                  required
                  placeholder="50000"
                  value={formData.price}
                  onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                  className="flex-1 px-3 py-2 border rounded-md"
                />
                <select
                  value={formData.price_currency}
                  onChange={(e) => setFormData({ ...formData, price_currency: e.target.value })}
                  className="w-20 px-2 py-2 border rounded-md text-sm"
                >
                  {CURRENCY_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Exchange *</label>
              <input
                type="text"
                required
                placeholder="Binance"
                value={formData.exchange}
                onChange={(e) => setFormData({ ...formData, exchange: e.target.value })}
                className="w-full px-3 py-2 border rounded-md"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Fees</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  step="0.00000001"
                  placeholder="0"
                  value={formData.fees}
                  onChange={(e) => setFormData({ ...formData, fees: e.target.value })}
                  className="flex-1 px-3 py-2 border rounded-md"
                />
                <select
                  value={formData.fees_currency}
                  onChange={(e) => setFormData({ ...formData, fees_currency: e.target.value })}
                  className="w-24 px-2 py-2 border rounded-md text-sm"
                >
                  {CURRENCY_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea
              rows={2}
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="w-full px-3 py-2 border rounded-md"
              placeholder="Optional notes..."
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 rounded border hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !formData.wallet_id}
              className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
