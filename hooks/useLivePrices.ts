'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

export type PricesMap = Record<string, number>

type PricesMeta = {
  count: number
  last_updated: string | null
  stale_tickers: string[]
  missing_tickers: string[]
}

type UseLivePricesResult = {
  prices: PricesMap
  meta: PricesMeta | null
  loading: boolean
  error: string | null
  lastRefresh: Date | null
  forceRefresh: () => void
}

const REFRESH_INTERVAL_MS = 60_000 // 60 secondi

export function useLivePrices(tickers?: string[]): UseLivePricesResult {
  const [prices, setPrices] = useState<PricesMap>({})
  const [meta, setMeta] = useState<PricesMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const mountedRef = useRef(true)

  const fetchPrices = useCallback(async () => {
    try {
      const params = tickers && tickers.length > 0
        ? `?tickers=${tickers.join(',')}`
        : ''
      const res = await fetch(`/api/prices/live${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!mountedRef.current) return
      setPrices(data.prices || {})
      setMeta(data.meta || null)
      setLastRefresh(new Date())
      setError(null)
    } catch (err: any) {
      if (!mountedRef.current) return
      setError(err.message)
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [tickers?.join(',')])

  const forceRefresh = useCallback(() => {
    setLoading(true)
    fetchPrices()
  }, [fetchPrices])

  useEffect(() => {
    mountedRef.current = true
    fetchPrices()

    intervalRef.current = setInterval(fetchPrices, REFRESH_INTERVAL_MS)

    return () => {
      mountedRef.current = false
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchPrices])

  return { prices, meta, loading, error, lastRefresh, forceRefresh }
}

// Helper: formatta il prezzo con il giusto numero di decimali
export function formatPrice(price: number | undefined): string {
  if (price === undefined || price === null) return '—'
  if (price >= 1000) return `$${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
  if (price >= 1) return `$${price.toFixed(4)}`
  if (price >= 0.01) return `$${price.toFixed(6)}`
  return `$${price.toFixed(8)}`
}