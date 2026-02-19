'use client'

import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody } from '@/components/ui/Card'

// ─── Coin Mappings ────────────────────────────────────────────────────────────

type CoinMappingRow = {
  ticker: string
  lcw_code: string | null
  name: string | null
  png_url: string | null
  has_mapping: boolean
  has_price: boolean
  price_usd: number | null
  price_updated_at: string | null
}

function CoinMappingsSection() {
  const [rows, setRows] = useState<CoinMappingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingTicker, setEditingTicker] = useState<string | null>(null)
  const [editLcw, setEditLcw] = useState('')
  const [editName, setEditName] = useState('')
  const [filter, setFilter] = useState<'all' | 'missing'>('all')

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/coin-mappings')
      const json = await res.json()
      setRows(json.rows || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const startEdit = (row: CoinMappingRow) => {
    setEditingTicker(row.ticker)
    setEditLcw(row.lcw_code || row.ticker)
    setEditName(row.name || '')
  }

  const cancelEdit = () => {
    setEditingTicker(null)
    setEditLcw('')
    setEditName('')
  }

  const saveMapping = async (ticker: string) => {
    if (!editLcw.trim()) return alert('LCW Code obbligatorio')
    setSaving(true)
    try {
      const res = await fetch('/api/coin-mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, lcw_code: editLcw.trim(), name: editName.trim() || null }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) return alert(j?.error || 'Errore salvataggio')
      cancelEdit()
      await load()
    } finally {
      setSaving(false)
    }
  }

  const deleteMapping = async (ticker: string) => {
    if (!confirm(`Rimuovere mapping per ${ticker}?\nI prezzi live non saranno più disponibili per questo ticker.`)) return
    setSaving(true)
    try {
      const res = await fetch(`/api/coin-mappings/${encodeURIComponent(ticker)}`, { method: 'DELETE' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) return alert(j?.error || 'Errore eliminazione')
      await load()
    } finally {
      setSaving(false)
    }
  }

  const fmtPrice = (p: number | null) => {
    if (p == null) return '—'
    if (p < 0.01) return '$' + p.toFixed(6)
    if (p < 1) return '$' + p.toFixed(4)
    return '$' + p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const fmtAge = (ts: string | null) => {
    if (!ts) return '—'
    const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
    if (secs < 60) return `${secs}s fa`
    if (secs < 3600) return `${Math.floor(secs / 60)}m fa`
    return `${Math.floor(secs / 3600)}h fa`
  }

  const filtered = filter === 'missing' ? rows.filter(r => !r.has_mapping) : rows
  const missingCount = rows.filter(r => !r.has_mapping).length

  return (
    <Card className="mb-4">
      <CardBody>
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-medium">Coin Mappings (LiveCoinWatch)</div>
            <div className="text-xs text-neutral-500 mt-0.5">
              Collega i tuoi ticker al codice LCW per ricevere i prezzi live.
            </div>
          </div>
          <div className="flex items-center gap-2">
            {missingCount > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                {missingCount} senza mapping
              </span>
            )}
            <button
              onClick={load}
              disabled={loading || saving}
              className="rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-xs hover:bg-neutral-50 disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Filtro */}
        <div className="flex gap-1 mb-3">
          {(['all', 'missing'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                filter === f
                  ? 'bg-blue-600 text-white'
                  : 'border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
              }`}
            >
              {f === 'all' ? 'Tutti' : `Mancanti (${missingCount})`}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-sm text-neutral-500">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-neutral-500">
            {filter === 'missing' ? 'Tutti i ticker hanno un mapping ✓' : 'Nessun ticker trovato.'}
          </div>
        ) : (
          <div className="overflow-auto rounded-2xl border border-neutral-200">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="border-b border-gray-200">
                  <th className="px-4 py-3 text-left text-xs uppercase text-gray-500">Ticker</th>
                  <th className="px-4 py-3 text-left text-xs uppercase text-gray-500">LCW Code</th>
                  <th className="px-4 py-3 text-left text-xs uppercase text-gray-500">Nome</th>
                  <th className="px-4 py-3 text-right text-xs uppercase text-gray-500">Prezzo Live</th>
                  <th className="px-4 py-3 text-right text-xs uppercase text-gray-500">Aggiornato</th>
                  <th className="px-4 py-3 text-right text-xs uppercase text-gray-500">Azioni</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {filtered.map(row => {
                  const isEditing = editingTicker === row.ticker
                  return (
                    <tr key={row.ticker} className={isEditing ? 'bg-blue-50' : row.has_mapping ? 'hover:bg-neutral-50' : 'bg-amber-50 hover:bg-amber-100'}>
                      <td className="px-4 py-3">
                        <span className="font-mono font-semibold text-neutral-900">{row.ticker}</span>
                        {!row.has_mapping && (
                          <span className="ml-2 rounded-full bg-amber-200 px-1.5 py-0.5 text-xs text-amber-800">no mapping</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input
                            value={editLcw}
                            onChange={e => setEditLcw(e.target.value)}
                            placeholder={row.ticker}
                            className="w-full rounded-xl border border-neutral-200 px-2 py-1 text-sm font-mono"
                            disabled={saving}
                          />
                        ) : (
                          <span className="font-mono text-neutral-700">{row.lcw_code || <span className="text-neutral-400">—</span>}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input
                            value={editName}
                            onChange={e => setEditName(e.target.value)}
                            placeholder="es. Ethereum"
                            className="w-full rounded-xl border border-neutral-200 px-2 py-1 text-sm"
                            disabled={saving}
                          />
                        ) : (
                          <span className="text-neutral-600">{row.name || <span className="text-neutral-400">—</span>}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={row.has_price ? 'font-medium text-neutral-900' : 'text-neutral-400'}>
                          {fmtPrice(row.price_usd)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-neutral-500">
                        {fmtAge(row.price_updated_at)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isEditing ? (
                          <div className="inline-flex gap-2">
                            <button
                              onClick={() => saveMapping(row.ticker)}
                              disabled={saving || !editLcw.trim()}
                              className="rounded-xl bg-green-600 px-3 py-1.5 text-xs text-white hover:bg-green-700 disabled:opacity-50"
                            >
                              {saving ? '...' : 'Salva'}
                            </button>
                            <button
                              onClick={cancelEdit}
                              disabled={saving}
                              className="rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-xs hover:bg-neutral-50"
                            >
                              Annulla
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex gap-2">
                            <button
                              onClick={() => startEdit(row)}
                              className="text-blue-700 hover:underline text-xs"
                              disabled={saving}
                            >
                              {row.has_mapping ? 'Modifica' : 'Aggiungi'}
                            </button>
                            {row.has_mapping && (
                              <button
                                onClick={() => deleteMapping(row.ticker)}
                                className="text-red-700 hover:underline text-xs"
                                disabled={saving}
                              >
                                Rimuovi
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 text-xs text-neutral-400">
          LCW Code = codice usato nelle API LiveCoinWatch. Di solito coincide con il ticker (es. ETH → ETH).
          Per casi speciali usa il prefisso underscore (es. SUI → _SUI). 
          <a href="https://livecoinwatch.com" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline ml-1">
            Cerca su livecoinwatch.com →
          </a>
        </div>
      </CardBody>
    </Card>
  )
}

type Wallet = {
  id: string
  name: string
  parent_wallet_id: string | null
}

function buildHierarchy(wallets: Wallet[]) {
  const roots = wallets.filter(w => !w.parent_wallet_id)
  const childrenMap = new Map<string, Wallet[]>()
  wallets.forEach(w => {
    if (!w.parent_wallet_id) return
    childrenMap.set(w.parent_wallet_id, [...(childrenMap.get(w.parent_wallet_id) || []), w])
  })

  const rows: Array<{ wallet: Wallet; displayName: string; level: number }> = []

  const walk = (w: Wallet, level: number) => {
    rows.push({
      wallet: w,
      displayName: `${'  '.repeat(level)}${level > 0 ? '↳ ' : ''}${w.name}`,
      level,
    })
    const kids = (childrenMap.get(w.id) || []).sort((a, b) => a.name.localeCompare(b.name))
    kids.forEach(k => walk(k, level + 1))
  }

  roots.sort((a, b) => a.name.localeCompare(b.name)).forEach(r => walk(r, 0))
  return rows
}

export default function SettingsPage() {
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // create form
  const [newName, setNewName] = useState('')
  const [newParent, setNewParent] = useState<string>('') // '' => root

  // edit
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editParent, setEditParent] = useState<string>('') // '' => root
  const [editMethod, setEditMethod] = useState<string>('AVG')
  const [walletMethods, setWalletMethods] = useState<Map<string, string>>(new Map())
  const [selectedWalletIds, setSelectedWalletIds] = useState<Set<string>>(new Set())

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/wallets')
      const json = await res.json()
      const ws = json.wallets || []
      setWallets(ws)
      setSelectedWalletIds(new Set())
      // Carica metodo contabile per ogni subwallet
      const subs = ws.filter((w: Wallet) => w.parent_wallet_id)
      if (subs.length > 0) {
        const methodMap = new Map<string, string>()
        await Promise.all(subs.map(async (w: Wallet) => {
          try {
            const r = await fetch(`/api/wallet-settings?wallet_id=${w.id}`)
            const j = await r.json()
            methodMap.set(w.id, j.accounting_method || 'AVG')
          } catch {}
        }))
        setWalletMethods(methodMap)
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load wallets')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const hierarchical = useMemo(() => buildHierarchy(wallets), [wallets])
  const roots = useMemo(() => wallets.filter(w => !w.parent_wallet_id), [wallets])

  const startEdit = (w: Wallet) => {
    setEditingId(w.id)
    setEditName(w.name)
    setEditParent(w.parent_wallet_id || '')
    setEditMethod(walletMethods.get(w.id) || 'AVG')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditName('')
    setEditParent('')
    setEditMethod('AVG')
  }

  const createWallet = async () => {
    if (!newName.trim()) return alert('Nome wallet obbligatorio')
    setSaving(true)
    try {
      const payload: any = { name: newName.trim() }
      if (newParent) payload.parent_wallet_id = newParent

      const res = await fetch('/api/wallets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const j = await res.json().catch(() => ({}))
      if (!res.ok) return alert(j?.error || 'Errore creazione wallet')

      setNewName('')
      setNewParent('')
      await load()
    } finally {
      setSaving(false)
    }
  }

  const saveEdit = async () => {
    if (!editingId) return
    if (!editName.trim()) return alert('Nome wallet obbligatorio')

    setSaving(true)
    try {
      const res = await fetch(`/api/wallets/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          parent_wallet_id: editParent || null,
        }),
      })

      const j = await res.json().catch(() => ({}))
      if (!res.ok) return alert(j?.error || 'Errore salvataggio')

      // Salva metodo contabile (solo per subwallet)
      if (editParent) {
        await fetch('/api/wallet-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet_id: editingId, target_pct: 0, accounting_method: editMethod }),
        })
      }

      cancelEdit()
      await load()
    } finally {
      setSaving(false)
    }
  }

  const deleteWallet = async (w: Wallet) => {
    if (!confirm(`Eliminare wallet "${w.name}"?\n\n(Se ha subwallet o transazioni collegate verrà bloccato)`)) return
    setSaving(true)
    try {
      const res = await fetch(`/api/wallets/${w.id}`, { method: 'DELETE' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) return alert(j?.error || 'Errore eliminazione')
      await load()
    } finally {
      setSaving(false)
    }
  }

  const toggleWalletSelection = (walletId: string, checked: boolean) => {
    setSelectedWalletIds(prev => {
      const next = new Set(prev)
      if (checked) next.add(walletId)
      else next.delete(walletId)
      return next
    })
  }

  const allWalletIds = useMemo(() => hierarchical.map(h => h.wallet.id), [hierarchical])
  const allSelected = allWalletIds.length > 0 && allWalletIds.every(id => selectedWalletIds.has(id))

  const toggleSelectAll = (checked: boolean) => {
    if (checked) setSelectedWalletIds(new Set(allWalletIds))
    else setSelectedWalletIds(new Set())
  }

  const bulkDeleteWallets = async () => {
    const ids = Array.from(selectedWalletIds)
    if (ids.length === 0) return

    if (!confirm(`Eliminare ${ids.length} wallet selezionati?\n\nI wallet con subwallet/transazioni verranno saltati.`)) return

    setSaving(true)
    try {
      const nameById = new Map(wallets.map(w => [w.id, w.name] as const))
      let deleted = 0
      const failed: string[] = []

      for (const id of ids) {
        const res = await fetch(`/api/wallets/${id}`, { method: 'DELETE' })
        const j = await res.json().catch(() => ({}))
        if (res.ok) {
          deleted++
        } else {
          const name = nameById.get(id) || id
          failed.push(`${name}: ${j?.error || 'Errore eliminazione'}`)
        }
      }

      await load()

      if (failed.length > 0) {
        alert(
          `Eliminati: ${deleted}\n` +
          `Non eliminati: ${failed.length}\n\n` +
          failed.slice(0, 8).join('\n') +
          (failed.length > 8 ? '\n…' : '')
        )
      } else {
        alert(`Eliminati ${deleted} wallet.`)
      }
    } finally {
      setSaving(false)
      setSelectedWalletIds(new Set())
    }
  }

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Gestione Wallet (crea / rinomina / sposta / elimina)"
        actions={
          <button
            onClick={load}
            className="rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-sm hover:bg-neutral-50"
            disabled={loading || saving}
          >
            Refresh
          </button>
        }
      />

      {error && (
        <Card className="mb-4 border-red-200 bg-red-50">
          <CardBody>
            <div className="text-sm font-medium text-red-700">Errore</div>
            <div className="text-sm text-red-600 mt-1">{error}</div>
          </CardBody>
        </Card>
      )}

      {/* Create */}
      <Card className="mb-4">
        <CardBody>
          <div className="text-sm font-medium mb-3">Crea wallet</div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nome wallet (es. BINANCE Spot)"
              className="rounded-xl border border-neutral-200 px-3 py-2 text-sm"
              disabled={saving}
            />

            <select
              value={newParent}
              onChange={(e) => setNewParent(e.target.value)}
              className="rounded-xl border border-neutral-200 px-3 py-2 text-sm"
              disabled={saving}
            >
              <option value="">Root wallet</option>
              {roots.map(r => (
                <option key={r.id} value={r.id}>
                  ↳ sotto: {r.name}
                </option>
              ))}
            </select>

            <button
              onClick={createWallet}
              disabled={saving || !newName.trim()}
              className="rounded-xl bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? '...' : 'Create'}
            </button>
          </div>

          <div className="mt-2 text-xs text-neutral-500">
            Root = contenitore (es. “Portfolio”). Subwallet = broker/exchange (es. “Binance Spot”).
          </div>
        </CardBody>
      </Card>

      {/* List */}
      <Card>
        <CardBody>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-sm font-medium">Wallets</div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-500">
                {selectedWalletIds.size} selezionati
              </span>
              <button
                onClick={bulkDeleteWallets}
                disabled={saving || selectedWalletIds.size === 0}
                className="rounded-xl border border-red-200 bg-white px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Elimina selezionati
              </button>
            </div>
          </div>

          {loading ? (
            <div className="text-sm text-neutral-500">Loading…</div>
          ) : wallets.length === 0 ? (
            <div className="text-sm text-neutral-500">Nessun wallet trovato.</div>
          ) : (
            <div className="overflow-auto rounded-2xl border border-neutral-200">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-xs uppercase text-gray-500">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={(e) => toggleSelectAll(e.target.checked)}
                        disabled={saving || allWalletIds.length === 0}
                        aria-label="Seleziona tutti i wallet"
                      />
                    </th>
                    <th className="px-4 py-3 text-left text-xs uppercase text-gray-500">Wallet</th>
                    <th className="px-4 py-3 text-left text-xs uppercase text-gray-500">Parent</th>
                    <th className="px-4 py-3 text-left text-xs uppercase text-gray-500">Metodo</th>
                    <th className="px-4 py-3 text-right text-xs uppercase text-gray-500">Actions</th>
                  </tr>
                </thead>

                <tbody className="bg-white divide-y divide-gray-200">
                  {hierarchical.map(({ wallet: w, displayName, level }) => {
                    const isEditing = editingId === w.id
                    const parentName =
                      w.parent_wallet_id ? wallets.find(x => x.id === w.parent_wallet_id)?.name : '— (root)'

                    return (
                      <tr key={w.id} className={isEditing ? 'bg-blue-50' : 'hover:bg-neutral-50'}>
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedWalletIds.has(w.id)}
                            onChange={(e) => toggleWalletSelection(w.id, e.target.checked)}
                            disabled={saving}
                            aria-label={`Seleziona wallet ${w.name}`}
                          />
                        </td>
                        <td className="px-4 py-3">
                          {isEditing ? (
                            <input
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm"
                              disabled={saving}
                            />
                          ) : (
                            <div className="font-medium" title={w.id}>
                              <span className={level === 0 ? 'text-neutral-900' : 'text-neutral-800'}>
                                {displayName}
                              </span>
                            </div>
                          )}
                        </td>

                        <td className="px-4 py-3">
                          {isEditing ? (
                            <select
                              value={editParent}
                              onChange={(e) => setEditParent(e.target.value)}
                              className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm"
                              disabled={saving}
                            >
                              <option value="">— (root)</option>
                              {roots
                                .filter(r => r.id !== w.id) // no self
                                .map(r => (
                                  <option key={r.id} value={r.id}>
                                    {r.name}
                                  </option>
                                ))}
                            </select>
                          ) : (
                            <span className="text-sm text-neutral-600">{parentName || '—'}</span>
                          )}
                        </td>

                        <td className="px-4 py-3">
                          {isEditing && w.parent_wallet_id ? (
                            <select
                              value={editMethod}
                              onChange={(e) => setEditMethod(e.target.value)}
                              className="rounded-xl border border-neutral-200 px-3 py-2 text-sm"
                              disabled={saving}
                            >
                              <option value="AVG">AVG</option>
                              <option value="LIFO">LIFO</option>
                              <option value="FIFO">FIFO</option>
                            </select>
                          ) : w.parent_wallet_id ? (
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              (walletMethods.get(w.id) || 'AVG') === 'LIFO' ? 'bg-purple-100 text-purple-700' :
                              (walletMethods.get(w.id) || 'AVG') === 'FIFO' ? 'bg-blue-100 text-blue-700' :
                              'bg-neutral-100 text-neutral-600'
                            }`}>
                              {walletMethods.get(w.id) || 'AVG'}
                            </span>
                          ) : (
                            <span className="text-xs text-neutral-400">—</span>
                          )}
                        </td>

                        <td className="px-4 py-3 text-right">
                          {isEditing ? (
                            <div className="inline-flex gap-2">
                              <button
                                onClick={saveEdit}
                                disabled={saving || !editName.trim()}
                                className="rounded-xl bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-700 disabled:opacity-50"
                              >
                                {saving ? '...' : 'Save'}
                              </button>
                              <button
                                onClick={cancelEdit}
                                disabled={saving}
                                className="rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="inline-flex gap-2">
                              <button
                                onClick={() => startEdit(w)}
                                className="text-blue-700 hover:underline text-sm"
                                disabled={saving}
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => deleteWallet(w)}
                                className="text-red-700 hover:underline text-sm"
                                disabled={saving}
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
      <CoinMappingsSection />
    </div>
  )
}
