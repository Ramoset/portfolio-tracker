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
const FIAT_STABLECOINS = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'FDUSD']

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
  const [transactions, setTransactions] = useState<any[]>([])

  // New wallet creation state
  const [showNewWalletForm, setShowNewWalletForm] = useState(false)
  const [newWalletName, setNewWalletName] = useState('')
  const [newWalletParent, setNewWalletParent] = useState<string>('')
  const [creatingWallet, setCreatingWallet] = useState(false)

  const [formData, setFormData] = useState({
    date: new Date().toISOString().slice(0, 16), // YYYY-MM-DDTHH:MM
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
    // NEW: swap quantities (UI-only, we map them into ticker/quantity/price on save)
    swap_from_qty: '',
    swap_to_qty: '',
    fees: '0',
    fees_currency: 'USDT',
    direction: '',
    leverage: '',
    notes: '',
  })

  useEffect(() => {
    loadWallets()
    loadTransactions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // If action changes away from SWAP, keep things as-is.
  // If action becomes SWAP, we can prefill some fields if already present.
  useEffect(() => {
    if (formData.action !== 'SWAP') return
    // When switching to SWAP, make sure fees_currency has some default
    if (!formData.fees_currency) {
      setFormData((p) => ({ ...p, fees_currency: p.price_currency || 'USDT' }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.action])

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

  const loadTransactions = async () => {
    try {
      const res = await fetch('/api/transactions?page=1&limit=1000')
      if (res.ok) {
        const data = await res.json()
        setTransactions(data.transactions || [])
      }
    } catch (e) {
      console.error('Failed to load transactions:', e)
    }
  }

  // Compute unique suggestions - NO SORTING, keep insertion order
  const suggestions = useMemo(() => {
    const tickersMap = new Map<string, boolean>()
    const currenciesMap = new Map<string, boolean>()
    const exchangesMap = new Map<string, boolean>()

    // Add from transactions (preserve order)
    transactions.forEach((tx) => {
      if (tx.ticker) tickersMap.set(String(tx.ticker).toUpperCase(), true)
      if (tx.price_currency) currenciesMap.set(String(tx.price_currency).toUpperCase(), true)
      if (tx.fees_currency) currenciesMap.set(String(tx.fees_currency).toUpperCase(), true)
      if (tx.exchange) exchangesMap.set(String(tx.exchange), true)
      if (tx.from_ticker) tickersMap.set(String(tx.from_ticker).toUpperCase(), true)
      if (tx.to_ticker) tickersMap.set(String(tx.to_ticker).toUpperCase(), true)
    })

    // Add default currencies
    CURRENCY_OPTIONS.forEach((c) => currenciesMap.set(c, true))

    return {
      tickers: Array.from(tickersMap.keys()),
      currencies: Array.from(currenciesMap.keys()),
      exchanges: Array.from(exchangesMap.keys()),
    }
  }, [transactions])

  // Helper: Check if ticker is FIAT or Stablecoin
  const isFiatOrStablecoin = (ticker: string): boolean => {
    return FIAT_STABLECOINS.includes((ticker || '').toUpperCase())
  }

  // Helper: Check if should hide price
  const shouldHidePrice = (): boolean => {
    const isDepositWithdrawal = ['DEPOSIT', 'WITHDRAWAL'].includes(formData.action)
    return isDepositWithdrawal && isFiatOrStablecoin(formData.ticker)
  }

  // Helper: Get filtered wallets
  const getFilteredWallets = (): Wallet[] => {
    if (shouldHidePrice()) {
      return wallets.filter((w) => !w.parent_wallet_id) // Only root wallets
    }
    return wallets
  }

  // Helper: Check if current wallet is root and ticker is crypto (should be in subwallet)
  const shouldShowSubwalletWarning = (): boolean => {
    if (!formData.wallet_id || !formData.ticker || !formData.action) return false

    // Only for non-FIAT/Stablecoin
    if (isFiatOrStablecoin(formData.ticker)) return false

    // Only for BUY/SELL/SWAP/AIRDROP (not DEPOSIT/WITHDRAWAL)
    const cryptoActions = ['BUY', 'SELL', 'SWAP', 'AIRDROP']
    if (!cryptoActions.includes(formData.action)) return false

    // Check if current wallet is root
    const currentWallet = wallets.find((w) => w.id === formData.wallet_id)
    return currentWallet ? !currentWallet.parent_wallet_id : false
  }

  const walletOptions = useMemo(() => {
    const filtered = getFilteredWallets()
    return filtered.map((w) => ({
      id: w.id,
      label: `${'  '.repeat(Math.max(0, w.level - 1))}${w.level > 0 ? '↳ ' : ''}${w.name}`,
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallets, formData.action, formData.ticker])

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

  // SWAP helpers
  const swapRate = useMemo(() => {
    if (formData.action !== 'SWAP') return ''
    const a = Number(formData.swap_from_qty)
    const b = Number(formData.swap_to_qty)
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return ''
    return (a / b).toString()
  }, [formData.action, formData.swap_from_qty, formData.swap_to_qty])

  const syncSwapComputedFields = (next: typeof formData) => {
    if (next.action !== 'SWAP') return next

    const fromTicker = (next.from_ticker || '').toUpperCase()
    const toTicker = (next.to_ticker || '').toUpperCase()
    const fromQty = Number(next.swap_from_qty)
    const toQty = Number(next.swap_to_qty)

    // We only compute when all required parts are present
    const canCompute =
      fromTicker &&
      toTicker &&
      Number.isFinite(fromQty) &&
      Number.isFinite(toQty) &&
      fromQty > 0 &&
      toQty > 0

    if (!canCompute) {
      return {
        ...next,
        from_ticker: fromTicker,
        to_ticker: toTicker,
      }
    }

    const rate = fromQty / toQty // price currency per 1 TO
    return {
      ...next,
      from_ticker: fromTicker,
      to_ticker: toTicker,
      // Map into your existing “one-row swap” schema:
      ticker: toTicker, // the asset you receive
      quantity: String(toQty), // how many you receive
      price: String(rate), // rate (FROM per 1 TO)
      price_currency: fromTicker, // currency of the rate
      // keep fees_currency coherent: default to FROM if empty
      fees_currency: (next.fees_currency || fromTicker || next.price_currency || 'USDT').toUpperCase(),
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      if (!formData.wallet_id) throw new Error('Wallet is required')
      if (!formData.exchange) throw new Error('Exchange is required')

      // SWAP validation (new UI)
      if (formData.action === 'SWAP') {
        const fromTicker = (formData.from_ticker || '').toUpperCase()
        const toTicker = (formData.to_ticker || '').toUpperCase()
        const fromQty = Number(formData.swap_from_qty)
        const toQty = Number(formData.swap_to_qty)

        if (!fromTicker) throw new Error('From ticker required for SWAP')
        if (!toTicker) throw new Error('To ticker required for SWAP')
        if (!Number.isFinite(fromQty) || fromQty <= 0) throw new Error('From quantity must be > 0')
        if (!Number.isFinite(toQty) || toQty <= 0) throw new Error('To quantity must be > 0')
      } else {
        // Non-swap validation
        if (!formData.ticker) throw new Error('Ticker is required')
        if (!formData.quantity || parseFloat(formData.quantity) <= 0) throw new Error('Quantity must be > 0')

        // Price validation (skip for DEPOSIT/WITHDRAWAL of FIAT/Stablecoin)
        if (!shouldHidePrice()) {
          if (!formData.price || parseFloat(formData.price) < 0) throw new Error('Price must be >= 0')
        }
      }

      // Build a safe snapshot (and for SWAP compute fields into the “row”)
      const computed = syncSwapComputedFields({ ...formData })

      // Price validation after SWAP computation (because SWAP auto-fills price)
      if (!shouldHidePrice()) {
        if (!computed.price || Number(computed.price) < 0) throw new Error('Price must be >= 0')
      }

      const payload = {
        date: new Date(computed.date).toISOString(),
        action: computed.action,
        ticker: computed.ticker.toUpperCase(),
        type: computed.type,
        quantity: parseFloat(computed.quantity),
        price: shouldHidePrice() ? 1 : parseFloat(computed.price),
        price_currency: shouldHidePrice()
          ? computed.ticker.toUpperCase()
          : computed.price_currency.toUpperCase(),
        exchange: computed.exchange,
        wallet_id: computed.wallet_id,
        from_ticker: computed.action === 'SWAP' ? computed.from_ticker.toUpperCase() : null,
        to_ticker: computed.action === 'SWAP' ? computed.to_ticker.toUpperCase() : null,
        fees: parseFloat(computed.fees || '0'),
        fees_currency: (computed.fees_currency || computed.price_currency).toUpperCase(),
        direction: computed.direction || null,
        leverage: computed.leverage ? parseFloat(computed.leverage) : null,
        notes: computed.notes || null,
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
      <div className="bg-white rounded-lg p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
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
                  {wallets
                    .filter((w) => w.level === 0)
                    .map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
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
          {/* Row 1: Date, Action */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Date & Time *</label>
              <input
                type="datetime-local"
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
                onChange={(e) => setFormData((p) => ({ ...p, action: e.target.value }))}
                className="w-full px-3 py-2 border rounded-md"
              >
                {TRANSACTION_ACTIONS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* SWAP Fields (new UI, still saved as 1 row) */}
          {formData.action === 'SWAP' && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
              <h3 className="text-sm font-medium mb-2">SWAP Details</h3>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">From (ticker) *</label>
                  <input
                    type="text"
                    required
                    placeholder="BTC"
                    list="swap-from-suggestions"
                    value={formData.from_ticker}
                    onChange={(e) => {
                      const next = syncSwapComputedFields({
                        ...formData,
                        from_ticker: e.target.value.toUpperCase(),
                      })
                      setFormData(next)
                    }}
                    className="w-full px-3 py-2 border rounded-md"
                  />
                  <datalist id="swap-from-suggestions">
                    {suggestions.tickers.map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">From (qty) *</label>
                  <input
                    type="number"
                    step="0.00000001"
                    required
                    placeholder="0.5"
                    value={formData.swap_from_qty}
                    onChange={(e) => {
                      const next = syncSwapComputedFields({
                        ...formData,
                        swap_from_qty: e.target.value,
                      })
                      setFormData(next)
                    }}
                    className="w-full px-3 py-2 border rounded-md"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">To (ticker) *</label>
                  <input
                    type="text"
                    required
                    placeholder="SOL"
                    list="swap-to-suggestions"
                    value={formData.to_ticker}
                    onChange={(e) => {
                      const next = syncSwapComputedFields({
                        ...formData,
                        to_ticker: e.target.value.toUpperCase(),
                      })
                      setFormData(next)
                    }}
                    className="w-full px-3 py-2 border rounded-md"
                  />
                  <datalist id="swap-to-suggestions">
                    {suggestions.tickers.map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">To (qty) *</label>
                  <input
                    type="number"
                    step="0.00000001"
                    required
                    placeholder="777"
                    value={formData.swap_to_qty}
                    onChange={(e) => {
                      const next = syncSwapComputedFields({
                        ...formData,
                        swap_to_qty: e.target.value,
                      })
                      setFormData(next)
                    }}
                    className="w-full px-3 py-2 border rounded-md"
                  />
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Rate (auto)</label>
                  <input
                    type="text"
                    readOnly
                    value={
                      swapRate
                        ? `${swapRate} ${formData.from_ticker.toUpperCase()} per 1 ${formData.to_ticker.toUpperCase()}`
                        : ''
                    }
                    className="w-full px-3 py-2 border rounded-md bg-white text-gray-700"
                  />
                  <p className="text-xs text-gray-600 mt-1">
                    Calcolato automaticamente: <b>from_qty / to_qty</b>
                  </p>
                </div>

                <div className="text-xs text-gray-600 flex items-end">
                  <div className="bg-white border rounded-md p-3 w-full">
                    <div className="font-semibold mb-1">Salvataggio “1 riga”</div>
                    <div>
                      ticker = <b>{(formData.ticker || '').toUpperCase() || '-'}</b>, qty ={' '}
                      <b>{formData.quantity || '-'}</b>
                    </div>
                    <div>
                      price = <b>{formData.price || '-'}</b> {formData.price_currency || ''}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Row 2: Ticker, Quantity (hidden for SWAP because derived) */}
          {formData.action !== 'SWAP' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Ticker *</label>
                <input
                  type="text"
                  required
                  placeholder="BTC"
                  list="ticker-suggestions"
                  value={formData.ticker}
                  onChange={(e) => setFormData({ ...formData, ticker: e.target.value.toUpperCase() })}
                  className="w-full px-3 py-2 border rounded-md"
                  style={{ WebkitAppearance: 'none', MozAppearance: 'textfield' }}
                />
                <datalist id="ticker-suggestions">
                  {suggestions.tickers.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
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
            </div>
          )}

          {/* Row 3: Price + Currency (hidden for SWAP because derived, and hidden for DEPOSIT/WITHDRAWAL of FIAT/Stablecoin) */}
          {formData.action !== 'SWAP' && !shouldHidePrice() && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Price *</label>
                <input
                  type="number"
                  step="0.00000001"
                  required
                  placeholder="50000"
                  value={formData.price}
                  onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Price Currency *</label>
                <input
                  type="text"
                  list="price-currency-suggestions"
                  value={formData.price_currency}
                  onChange={(e) => setFormData({ ...formData, price_currency: e.target.value.toUpperCase() })}
                  placeholder="USDT"
                  className="w-full px-3 py-2 border rounded-md"
                  style={{ WebkitAppearance: 'none' }}
                />
                <datalist id="price-currency-suggestions">
                  {suggestions.currencies.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
            </div>
          )}

          {/* Row 4: Fees + Currency */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Fees</label>
              <input
                type="number"
                step="0.00000001"
                placeholder="0"
                value={formData.fees}
                onChange={(e) => setFormData({ ...formData, fees: e.target.value })}
                className="w-full px-3 py-2 border rounded-md"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Fees Currency</label>
              <input
                type="text"
                list="fees-currency-suggestions"
                value={formData.fees_currency}
                onChange={(e) => setFormData({ ...formData, fees_currency: e.target.value.toUpperCase() })}
                placeholder="USDT"
                className="w-full px-3 py-2 border rounded-md"
                style={{ WebkitAppearance: 'none' }}
              />
              <datalist id="fees-currency-suggestions">
                {suggestions.currencies.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          </div>

          {/* Row 5: Exchange */}
          <div>
            <label className="block text-sm font-medium mb-1">Exchange *</label>
            <input
              type="text"
              required
              list="exchange-suggestions"
              placeholder="Binance"
              value={formData.exchange}
              onChange={(e) => setFormData({ ...formData, exchange: e.target.value })}
              className="w-full px-3 py-2 border rounded-md"
              style={{ WebkitAppearance: 'none' }}
            />
            <datalist id="exchange-suggestions">
              {suggestions.exchanges.map((ex) => (
                <option key={ex} value={ex} />
              ))}
            </datalist>
          </div>

          {/* Row 6: Wallet */}
          <div>
            <label className="block text-sm font-medium mb-1">Wallet *</label>
            <select
              required
              value={formData.wallet_id}
              onChange={(e) => handleWalletChange(e.target.value)}
              disabled={walletsLoading}
              className="w-full px-3 py-2 border rounded-md"
              style={{ WebkitAppearance: 'menulist', minWidth: '200px' }}
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
            {shouldHidePrice() && (
              <p className="text-xs text-blue-600 mt-1">Only root wallets shown for FIAT/Stablecoin deposits/withdrawals</p>
            )}
            {shouldShowSubwalletWarning() && (
              <p className="text-xs text-red-600 mt-1 font-semibold">
                ⚠️ Crypto transactions should be in a subwallet (e.g., Binance Spot, Bybit, etc.)
              </p>
            )}
          </div>

          {/* Row 7: Notes */}
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
