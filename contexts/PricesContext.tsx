'use client'

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'

type PricesContextType = {
  lastUpdate: Date | null
  isRefreshing: boolean
  refreshPrices: () => Promise<void>
}

const PricesContext = createContext<PricesContextType | undefined>(undefined)

export function PricesProvider({ children }: { children: ReactNode }) {
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const refreshPrices = useCallback(async () => {
    if (isRefreshing) return // Evita refresh multipli simultanei
    
    setIsRefreshing(true)
    try {
      const res = await fetch('/api/prices/live-refresh', { method: 'POST' })
      if (res.ok) {
        setLastUpdate(new Date())
      }
    } catch (err) {
      console.error('Price refresh failed:', err)
    } finally {
      setIsRefreshing(false)
    }
  }, [isRefreshing])

  // Auto-refresh al mount (login)
  useEffect(() => {
    refreshPrices()
  }, []) // Solo al mount

  // Auto-refresh ogni ora
  useEffect(() => {
    const interval = setInterval(() => {
      refreshPrices()
    }, 60 * 60 * 1000) // 1 ora

    return () => clearInterval(interval)
  }, [refreshPrices])

  return (
    <PricesContext.Provider value={{ lastUpdate, isRefreshing, refreshPrices }}>
      {children}
    </PricesContext.Provider>
  )
}

export function usePrices() {
  const context = useContext(PricesContext)
  if (!context) {
    throw new Error('usePrices must be used within PricesProvider')
  }
  return context
}
